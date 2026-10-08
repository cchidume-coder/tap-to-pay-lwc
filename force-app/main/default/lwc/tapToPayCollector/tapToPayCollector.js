import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getPaymentsService } from 'lightning/mobileCapabilities';
import { CONFIG } from 'c/tapToPayConfig';

import ACCOUNT_ID_FIELD from '@salesforce/schema/WorkOrder.AccountId';
import WORK_ORDER_NUMBER_FIELD from '@salesforce/schema/WorkOrder.WorkOrderNumber';

// Work Order is used only for payer and payment attribution.
const WORK_ORDER_FIELDS = [ACCOUNT_ID_FIELD, WORK_ORDER_NUMBER_FIELD];

// Sales-tax rate applied to the subtotal on the checkout screen.
const TAX_RATE = CONFIG.taxRatePercent / 100;
// Tip is applied to the pre-tax subtotal (standard US convention).
const TIP_PRESETS = [15, 18, 20, 0];

export default class TapToPayCollector extends LightningElement {
    @api recordId;

    myPaymentsService;
    paymentServiceUnavailable = false;
    tapToPayUnAvailable = false;

    // Steps: 'amount' (enter + check connectivity) -> 'checkout' (tip + pay) -> 'done'
    @track step = 'amount';

    @track amountValue = 0;
    @track payerAccountIdValue = '';
    @track workOrderNumber = '';
    @track currencyCodeValue = CONFIG.currencyIsoCode;
    @track countryCodeValue = CONFIG.countryIsoCode;
    @track paymentMethodValue = 'TAP_TO_PAY';
    @track merchantNameValue = CONFIG.merchantName;
    @track merchantAccountIdValue = CONFIG.merchantAccountId;
    @track spinnerEnabled = false;
    @track paymentsServiceResponse = '';
    @track inputValidationClass = '';

    // Tipping
    @track tipPercent = 18;          // preset selection; null when a custom amount is used
    @track customTipAmount = null;   // dollar amount entered via "Other"
    @track showCustomTip = false;
    @track methodChecked = false;    // Tap-to-Pay connectivity confirmed

    // A watchdog bounds waiting, without assuming the payment failed.
    collectTimeoutId;
    collectTimeoutMs = CONFIG.paymentTimeoutMs;
    outcomeUnknown = false;
    operationId = 0;

    @wire(getRecord, { recordId: '$recordId', fields: WORK_ORDER_FIELDS })
    wiredWorkOrder({ data, error }) {
        if (data) {
            this.payerAccountIdValue = getFieldValue(data, ACCOUNT_ID_FIELD) ?? '';
            this.workOrderNumber = getFieldValue(data, WORK_ORDER_NUMBER_FIELD) ?? '';
        } else if (error) {
            this.paymentsServiceResponse = `Unable to load Work Order: ${error.body?.message ?? error.message}`;
        }
    }

    connectedCallback() {
        this.myPaymentsService = getPaymentsService();
        if (!this.myPaymentsService?.isAvailable()) {
            this.paymentServiceUnavailable = true;
            this.paymentsServiceResponse = 'Payments Service is unavailable. Open this Work Order in the Salesforce Field Service mobile app.';
        }
    }

    disconnectedCallback() {
        clearTimeout(this.collectTimeoutId);
        this.operationId += 1;
        this.spinnerEnabled = false;
    }

    /* ---------- step flags (for template if:true) ---------- */
    get isAmountStep() { return this.step === 'amount'; }
    get isCheckoutStep() { return this.step === 'checkout'; }
    get isDoneStep() { return this.step === 'done'; }

    /* ---------- money math ---------- */
    get subtotal() {
        const n = Number(this.amountValue);
        return Number.isFinite(n) && n >= 0 ? this.round2(n) : 0;
    }
    get taxAmount() {
        return this.round2(this.subtotal * TAX_RATE);
    }
    get tipAmount() {
        if (this.showCustomTip) {
            const c = Number(this.customTipAmount);
            return !Number.isFinite(c) || c < 0 ? 0 : this.round2(c);
        }
        return this.round2(this.subtotal * (this.tipPercent / 100));
    }
    get total() {
        return this.round2(this.subtotal + this.taxAmount + this.tipAmount);
    }

    get subtotalDisplay() { return this.formatMoney(this.subtotal); }
    get taxDisplay() { return this.formatMoney(this.taxAmount); }
    get tipDisplay() { return this.formatMoney(this.tipAmount); }
    get totalDisplay() { return this.formatMoney(this.total); }

    round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
    formatMoney(n) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: this.currencyCodeValue || 'USD'
        }).format(Number(n) || 0);
    }

    /* ---------- tip options (rendered as chips) ---------- */
    get tipOptions() {
        return TIP_PRESETS.map((p) => ({
            key: `tip-${p}`,
            label: `${p}%`,
            percent: p,
            selected: !this.showCustomTip && this.tipPercent === p,
            // SLDS2-styled chip; "is-selected" toggles the accent ring/text.
            cssClass: `tip-chip${!this.showCustomTip && this.tipPercent === p ? ' is-selected' : ''}`
        }));
    }
    get otherChipClass() {
        return `tip-chip${this.showCustomTip ? ' is-selected' : ''}`;
    }

    handleTipSelect(event) {
        if (this.inputsDisabled) return;
        const percent = Number(event.currentTarget.dataset.percent);
        this.showCustomTip = false;
        this.customTipAmount = null;
        this.tipPercent = percent;
    }
    handleOtherTip() {
        if (this.inputsDisabled) return;
        this.showCustomTip = true;
        this.tipPercent = null;
        if (this.customTipAmount == null) this.customTipAmount = 0;
    }
    handleCustomTipInput(event) {
        if (this.inputsDisabled) return;
        this.customTipAmount = event.target.value;
    }

    /* ---------- step 1: amount + connectivity ---------- */
    handleAmountInput(event) {
        if (this.inputsDisabled) return;
        this.amountValue = event.target.value;
        if (this.inputValidationClass) this.inputValidationClass = '';
    }
    handleCurrencyCodeInput(event) { if (this.inputsDisabled) return; this.currencyCodeValue = event.target.value; this.methodChecked = false; }

    get currencyOptions() {
        return [
            { label: 'USD', value: 'USD' },
            { label: 'EUR', value: 'EUR' },
            { label: 'GBP', value: 'GBP' },
            { label: 'CAD', value: 'CAD' },
            { label: 'AUD', value: 'AUD' }
        ];
    }

    get configurationMissing() { return !this.merchantAccountIdValue?.trim(); }
    get availabilityCheckDisabled() { return this.paymentServiceUnavailable || this.configurationMissing || this.spinnerEnabled || this.outcomeUnknown; }
    get inputsDisabled() { return this.spinnerEnabled || this.outcomeUnknown; }
    get invalidCustomTip() {
        const value = Number(this.customTipAmount);
        return this.showCustomTip && (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)));
    }

    // "Next" is enabled once we have a valid amount and Tap-to-Pay is confirmed.
    get nextDisabled() {
        return this.availabilityCheckDisabled || this.tapToPayUnAvailable ||
            !this.methodChecked || !this.payerAccountIdValue || !(this.subtotal > 0) || !this.validAmount;
    }
    get payDisabled() {
        return this.nextDisabled || this.invalidCustomTip || !(this.total > 0) || this.step !== 'checkout';
    }

    get validAmount() {
        const value = Number(this.amountValue);
        return Number.isFinite(value) && value > 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value - this.round2(value)) < 1e-8;
    }
    validateAmount() {
        if (!this.validAmount) {
            this.inputValidationClass = 'invalidInput';
            return false;
        }
        this.inputValidationClass = '';
        return true;
    }

    async handleBeginSupportedMethodCheck() {
        if (this.availabilityCheckDisabled) return;
        this.methodChecked = false;
        if (!this.myPaymentsService?.isAvailable()) {
            this.paymentServiceUnavailable = true;
            return;
        }
        this.spinnerEnabled = true;
        const id = ++this.operationId;
        let timer;
        try {
            const result = await Promise.race([
                Promise.resolve().then(() => this.myPaymentsService.getSupportedPaymentMethods({
                    countryIsoCode: this.countryCodeValue, merchantAccountId: this.merchantAccountIdValue
                })),
                new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Availability check timed out. Try verifying again.')), CONFIG.availabilityTimeoutMs); this.collectTimeoutId = timer; })
            ]);
            if (id !== this.operationId) return;
            this.methodChecked = Array.isArray(result) && result.includes('TAP_TO_PAY');
            this.tapToPayUnAvailable = !this.methodChecked;
            this.paymentsServiceResponse = this.methodChecked ? 'Tap to Pay is ready on this device.' : 'Tap to Pay is not supported for this merchant/region.';
        } catch (error) {
            if (id === this.operationId) this.processError(error);
        } finally {
            clearTimeout(timer);
            if (id === this.operationId) this.spinnerEnabled = false;
        }
    }

    handleNext() {
        if (this.nextDisabled) return;
        this.step = 'checkout';
    }
    handleBack() {
        if (this.inputsDisabled) return;
        this.step = 'amount';
    }

    /* ---------- step 2: pay ---------- */
    handleCollectPayment() {
        if (this.payDisabled) return;
        if (!this.myPaymentsService?.isAvailable()) { this.paymentServiceUnavailable = true; return; }
        if (!(this.total > 0)) {
            this.popupPush('Nothing to charge.', 'error');
            return;
        }
        this.spinnerEnabled = true;
        const options = {
            amount: Number(this.total),
            currencyIsoCode: this.currencyCodeValue,
            paymentMethod: this.paymentMethodValue,
            merchantName: this.merchantNameValue,
            merchantAccountId: this.merchantAccountIdValue
        };
        if (this.payerAccountIdValue) options.payerAccountId = this.payerAccountIdValue;
        if (this.recordId) options.sourceObjectIds = [this.recordId];

        // A timeout releases the UI but cannot cancel native processing.
        const id = ++this.operationId;
        let settled = false;
        const finish = (fn) => {
            if (settled || id !== this.operationId) return;
            settled = true;
            clearTimeout(this.collectTimeoutId);
            this.spinnerEnabled = false;
            if (fn) fn();
        };

        this.collectTimeoutId = setTimeout(() => {
            finish(() => {
                this.outcomeUnknown = true;
                this.paymentsServiceResponse =
                    'No response from the payment reader. If the card was tapped, ' +
                    'verify the payment in Salesforce Payments before retrying — ' +
                    'do not assume it failed. (Timed out waiting for collectPayment.)';
                this.popupPush(
                    'Timed out waiting for the payment reader. Check Payments before retrying.',
                    'warning'
                );
            });
        }, this.collectTimeoutMs);

        Promise.resolve().then(() => this.myPaymentsService.collectPayment(options))
            .then((result) => {
                if (id !== this.operationId) return;
                if (settled && this.outcomeUnknown) { this.outcomeUnknown = false; this.processResult(result); }
                else finish(() => this.processResult(result));
            })
            .catch((error) => {
                if (id !== this.operationId) return;
                if (settled && this.outcomeUnknown) { this.outcomeUnknown = false; this.processError(error); }
                else finish(() => this.processError(error));
            });
    }

    processResult(result) {
        const status = String(result?.status || '').toLowerCase();
        this.paymentsServiceResponse = 'Payment status: ' + (result?.status || 'unknown') + '. Reference: ' + (result?.guid || result?.gatewayRefId || 'not returned');
        if (status === 'success') {
            this.step = 'done';
            this.popupPush(this.totalDisplay + ' collected successfully.', 'success');
        } else if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
            this.popupPush('Payment was not completed. ' + this.paymentsServiceResponse, 'warning');
        } else {
            this.outcomeUnknown = true;
            this.paymentsServiceResponse += '. Verify the PaymentIntent before starting another payment.';
        }
    }

    processError(error) {
        const code = error?.code;
        const messages = {
            USER_DISMISSED: 'Payment canceled by user.',
            USER_DENIED_PERMISSION: 'Allow device location access to use Tap to Pay.',
            SERVICE_NOT_ENABLED: 'Payments Service is not enabled. Contact your Salesforce administrator.'
        };
        this.paymentsServiceResponse = messages[code] || (error?.message || 'The payment service returned an unexpected error.');
        this.popupPush(this.paymentsServiceResponse, code === 'USER_DISMISSED' ? 'warning' : 'error');
    }

    handleVerifiedUnpaid() {
        // Explicit reconciliation is required; this does not cancel a native request.
        if (!this.outcomeUnknown || this.spinnerEnabled) return;
        this.operationId += 1;
        this.outcomeUnknown = false;
        this.methodChecked = false;
        this.step = 'amount';
        this.paymentsServiceResponse = 'Verify Tap to Pay again before starting a new attempt.';
    }

    handleStartOver() {
        if (this.inputsDisabled) return;
        this.step = 'amount';
        this.methodChecked = false;
        this.tapToPayUnAvailable = false;
        this.tipPercent = 18;
        this.showCustomTip = false;
        this.customTipAmount = null;
        this.paymentsServiceResponse = '';
    }

    popupPush(text, variant) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Tap to Pay',
            message: text,
            variant,
            mode: 'sticky'
        }));
    }
}
