"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var rxjs_1 = require("rxjs");
var operators_1 = require("rxjs/operators");
var defaultOptions = {
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
    var options = Object.assign({}, defaultOptions, userOptions);
    /**
     * Currently any new error, after recover, continues the series of  increasing
     * delays, like 2 consequent errors would do. This is a bug of RxJS. To workaround
     * the issue we use the difference with the counter value at the last recover.
     * @see https://github.com/ReactiveX/rxjs/issues/1413
     */
    var allErrorsCount = 0;
    var lastRecoverCount = 0;
    return (0, rxjs_1.fromEvent)(document, 'visibilitychange').pipe((0, operators_1.startWith)(null), (0, operators_1.switchMap)(function () {
        if (isPageActive() || options.backgroundPolling) {
            var firstRequest$ = request$;
            var polling$ = (0, rxjs_1.interval)(options.interval).pipe((0, operators_1.take)(1), (0, operators_1.switchMap)(function () { return request$; }), (0, operators_1.repeat)());
            return (0, rxjs_1.concat)(firstRequest$, polling$).pipe((0, operators_1.retryWhen)(function (errors$) {
                return errors$.pipe((0, operators_1.scan)(function (_a, err) {
                    var errorCount = _a.errorCount;
                    return { errorCount: errorCount + 1, error: err };
                }, { errorCount: 0, error: null }), (0, operators_1.switchMap)(function (_a) {
                    var errorCount = _a.errorCount, error = _a.error;
                    allErrorsCount = errorCount;
                    var consecutiveErrorsCount = allErrorsCount - lastRecoverCount;
                    // If already tempted too many times don't retry
                    if (consecutiveErrorsCount > options.attempts)
                        throw error;
                    var delay = getStrategyDelay(consecutiveErrorsCount, options);
                    return (0, rxjs_1.timer)(delay, null);
                }));
            }));
        }
        return (0, rxjs_1.empty)();
    }), (0, operators_1.tap)(function () {
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
            var _a = options.randomRange, min = _a[0], max = _a[1];
            // eslint-disable-next-line no-case-declarations
            var range = max - min;
            return Math.floor(Math.random() * range) + min;
        case 'consecutive':
            return options.constantTime || options.interval;
        default:
            console.error("".concat(options.backoffStrategy, " is not a backoff strategy supported by rx-polling"));
            return options.constantTime || options.interval;
    }
}
