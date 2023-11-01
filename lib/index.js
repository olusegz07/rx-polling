"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const defaultOptions = {
    attempts: 9,
    backoffStrategy: 'exponential',
    exponentialUnit: 1000,
    randomRange: [1000, 10000],
    backgroundPolling: false
};
/**
 * Run a polling stream for the source$
 * @param request$ Source Observable which will be ran every interval
 * @param userOptions Polling options
 */
function polling(request$, userOptions) {
    const options = Object.assign({}, defaultOptions, userOptions);
    /**
     * Currently any new error, after recover, continues the series of  increasing
     * delays, like 2 consequent errors would do. This is a bug of RxJS. To workaround
     * the issue we use the difference with the counter value at the last recover.
     * @see https://github.com/ReactiveX/rxjs/issues/1413
     */
    let allErrorsCount = 0;
    let lastRecoverCount = 0;
    return (0, rxjs_1.fromEvent)(document, 'visibilitychange').pipe((0, operators_1.startWith)(null), (0, operators_1.switchMap)(() => {
        if (isPageActive() || options.backgroundPolling) {
            const firstRequest$ = request$;
            const polling$ = (0, rxjs_1.interval)(options.interval).pipe((0, operators_1.take)(1), (0, operators_1.switchMap)(() => request$), (0, operators_1.repeat)());
            return (0, rxjs_1.concat)(firstRequest$, polling$).pipe((0, operators_1.retryWhen)(errors$ => {
                return errors$.pipe((0, operators_1.scan)(({ errorCount }, err) => {
                    return { errorCount: errorCount + 1, error: err };
                }, { errorCount: 0, error: null }), (0, operators_1.switchMap)(({ errorCount, error }) => {
                    allErrorsCount = errorCount;
                    const consecutiveErrorsCount = allErrorsCount - lastRecoverCount;
                    // If already tempted too many times don't retry
                    if (consecutiveErrorsCount > options.attempts)
                        throw error;
                    const delay = getStrategyDelay(consecutiveErrorsCount, options);
                    return (0, rxjs_1.timer)(delay, null);
                }));
            }));
        }
        return (0, rxjs_1.empty)();
    }), (0, operators_1.tap)(() => {
        // Update the counter after every successful polling
        lastRecoverCount = allErrorsCount;
    }));
}
exports.default = polling;
function isPageActive() {
    return !document.hidden;
}
function getStrategyDelay(consecutiveErrorsCount, options) {
    switch (options.backoffStrategy) {
        case 'exponential':
            return Math.pow(2, consecutiveErrorsCount - 1) * options.exponentialUnit;
        case 'random':
            // eslint-disable-next-line no-case-declarations
            const [min, max] = options.randomRange;
            // eslint-disable-next-line no-case-declarations
            const range = max - min;
            return Math.floor(Math.random() * range) + min;
        case 'consecutive':
            return options.constantTime || options.interval;
        default:
            console.error(`${options.backoffStrategy} is not a backoff strategy supported by rx-polling`);
            return options.constantTime || options.interval;
    }
}
