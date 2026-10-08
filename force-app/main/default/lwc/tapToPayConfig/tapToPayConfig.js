// Configure for the recipient org before deploying. These values are not secrets.
export const CONFIG = Object.freeze({
    merchantAccountId: '',
    merchantName: 'Salesforce Payments',
    countryIsoCode: 'US',
    currencyIsoCode: 'USD',
    taxRatePercent: 8.25,
    paymentTimeoutMs: 90000,
    availabilityTimeoutMs: 30000
});
