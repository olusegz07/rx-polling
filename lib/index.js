"use strict";
import { fromEvent, interval, empty, timer, concat } from "rxjs";
import { startWith, switchMap, take, repeat, retryWhen, scan, tap } from "rxjs/operators";

const defaultOptions = {
    attempts: 9,
    backoffStrategy: 'exponential',
    exponentialUnit: 1000,
    randomRange: [1000, 10000],
    backgroundPolling: false,
    interval: 1000,
};

/**
 * Run a polling stream for the source$
 * @param request$ Source Observable which will be ran every interval
 * @param userOptions Polling options
 */
function polling(request$, userOptions) {
    const options = { ...defaultOptions, ...userOptions };

    let allErrorsCount = 0;
    let lastRecoverCount = 0;

    return fromEvent(document, 'visibilitychange').pipe(
        startWith(null),
        switchMap(() => {
            if (isPageActive() || options.backgroundPolling) {
                const firstRequest$ = request$;
                const polling$ = interval(options.interval).pipe(
                    take(1),
                    switchMap(() => request$),
                    repeat()
                );

                return concat(firstRequest$, polling$).pipe(
                    retryWhen(errors$ =>
                        errors$.pipe(
                            scan((acc, err) => ({ errorCount: acc.errorCount + 1, error: err }), {
                                errorCount: 0,
                                error: null
                            }),
                            switchMap(({ errorCount, error }) => {
                                allErrorsCount = errorCount;
                                const consecutiveErrorsCount = allErrorsCount - lastRecoverCount;

                                if (consecutiveErrorsCount > options.attempts) {
                                    throw error;
                                }

                                const delay = getStrategyDelay(consecutiveErrorsCount, options);
                                return timer(delay);
                            })
                        )
                    )
                );
            }

            return empty();
        }),
        tap(() => {
            lastRecoverCount = allErrorsCount;
        })
    );
}

function isPageActive() {
    return !document.hidden;
}

function getStrategyDelay(consecutiveErrorsCount, options) {
    switch (options.backoffStrategy) {
        case 'exponential':
            return Math.pow(2, consecutiveErrorsCount - 1) * options.exponentialUnit;
        case 'random':
            const [min, max] = options.randomRange;
            const range = max - min;
            return Math.floor(Math.random() * range) + min;
        case 'consecutive':
            return options.constantTime || options.interval;
        default:
            console.error(`${options.backoffStrategy} is not a backoff strategy supported by rx-polling`);
            return options.constantTime || options.interval;
    }
}

export default polling;
