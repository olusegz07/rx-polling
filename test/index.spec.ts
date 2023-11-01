import { Observable, of, timer, interval, throwError, Observer } from 'rxjs';
import { take, map, delay } from 'rxjs/operators';
import { TestScheduler } from 'rxjs/testing';
import * as RxMock from 'rxjs';
import { polling } from '../index';
import { matcherHint, printReceived, printExpected } from 'jest-matcher-utils';
import { diffTestMessages } from './utils';


function assertDeepEqual(actual: any, expected: any): any {
  try {
    expect(actual).toEqual(expected);
  } catch (error) {
    const hint = matcherHint('.toEqual', undefined, undefined, { isNot: false });
    const diffString = diffTestMessages(expected, actual);

    const errorMessage = () => {
      return `${hint}\n\nExpected: ${printExpected(expected)}\nReceived: ${printReceived(actual)}\n${diffString}`;
    };

    throw new Error(errorMessage());
  }
}

function setPageActive(isActive: boolean) {
  Object.defineProperty(document, 'hidden', {
    value: !isActive,
    configurable: true
  });
}

describe('Basic behaviour', function() {
  let scheduler: TestScheduler;

  beforeEach(() => {
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true
    });

    scheduler = new TestScheduler(assertDeepEqual);

    document.addEventListener = function(eventType, callback) {
      // Noop
    };

    document.removeEventListener = () => void 0;
    document.dispatchEvent = () => void 0;
  });

  test('It should poll the source$ every interval', () => {
    scheduler.run(helpers => {
      const source$ = of(1);
      const polling$ = polling(source$, { interval: 2 }).pipe(take(3));
      const expected = '1-1-(1|)';

      helpers.expectObservable(polling$).toBe(expected, { 1: 1 });
    });
  });

  test('It should not poll if the tab is inactive and background polling is default', () => {
    setPageActive(false);

    scheduler.run(helpers => {
      const source$ = of('Hello');
      const polling$ = polling(source$, { interval: 2 }).pipe(take(3));
      const expected = '----';

      helpers.expectObservable(polling$).toBe(expected);
    });
  });

  test('It should not poll if the tab is inactive and background polling is false', () => {
    setPageActive(false);

    scheduler.run(helpers => {
      const source$ = of('Hello');
      const polling$ = polling(source$, { interval: 2, backgroundPolling: false }).pipe(take(3));
      const expected = '----';

      helpers.expectObservable(polling$).toBe(expected);
    });
  });

  test('It should poll if the tab is inactive and background polling is true', () => {
    setPageActive(false);

    scheduler.run(helpers => {
      const source$ = of(1);
      const polling$ = polling(source$, { interval: 2, backgroundPolling: true }).pipe(take(3));
      const expected = '1-1-(1|)';

      helpers.expectObservable(polling$).toBe(expected, { 1: 1 });
    });
  });

  test('It should restart polling if the tab changes to active', () => {
    setPageActive(false);

    scheduler.run(helpers => {
      document.addEventListener = function(eventType, listener) {
        // At frame 4 simulate 'visibilitychange' Event
        timer(4, null)
          .pipe(map(() => 'event'))
          .subscribe(() => {
            setPageActive(true);
            listener();
          });
      };

      const source$ = of(1);
      const polling$ = polling(source$, { interval: 20 }).pipe(take(1));
      const expected = '----(1|)';

      helpers.expectObservable(polling$).toBe(expected, { 1: 1 });
    });
  });

  test('It should stop polling on unsubscription', () => {
    const ops = [];
    const source$ = Observable.create((observer: Observer<number>) => {
      ops.push('next');
      observer.next(1);
      observer.complete();
    });
    const polling$ = polling(source$, { interval: 5 });

    const subscription = polling$.subscribe(() => {
      // Noop
    });

    return interval(9)
      .pipe(take(1))
      .toPromise()
      .then(() => {
        subscription.unsubscribe();
        expect(ops.length).toBe(2); // 1 first request then 1 repeat
      });
  });

  test('It should retry on error', () => {
    scheduler.run(helpers => {
      const source$ = scheduler.createColdObservable('-1-2-#');
      const expected = '-1-2- 3ms -1-(2|)';
      const polling$ = polling(source$, { interval: 6, exponentialUnit: 3 }).pipe(take(4));

      helpers.expectObservable(polling$).toBe(expected);
    });
  });

  test('It should not repoll if latency > interval', () => {
    scheduler.run(helpers => {
      const source$ = of(1).pipe(delay(10));
      const expected = '10ms 1 14ms (1|)';
      const polling$ = polling(source$, { interval: 5 }).pipe(take(2));

      helpers.expectObservable(polling$).toBe(expected, { 1: 1 });
    });
  });

  test('It should reset delays on not consecutive errors', () => {
    scheduler.run(helpers => {
      /**
       * `.retryWhen` doesn't reset its state after a recover. This cause the
       * next error to continue the series of increasing delays, like 2 consecutive
       * errors would do.
       * @see https://github.com/ReactiveX/rxjs/issues/1413
       */
      const source$ = helpers.cold('-1-2-#');
      const expected = '-1-2- 3ms -1-2- 3ms -(1|)';
      const polling$ = polling(source$, { interval: 6, exponentialUnit: 3 }).pipe(take(5));

      helpers.expectObservable(polling$).toBe(expected);
    });
  });
});

describe('Backoff behaviour', function() {
  let timerMock: jest.Mock<any>;

  beforeEach(() => {
    Object.defineProperty(document, 'hidden', {
      value: false
    });

    timerMock = jest.fn(() => {
      // Emit immediately
      return of(null);
    });
    Object.defineProperty(RxMock, 'timer', {
      value: timerMock
    });

    document.addEventListener = function(eventType, callback) {
      // Noop
    };

    document.removeEventListener = () => void 0;
    document.dispatchEvent = () => void 0;
  });

  test('It should throw after all failed attempts', () => {
    const polling$ = polling(throwError('Hello'), { interval: 10, attempts: 9 });
    polling$.subscribe(
      () => {
        // Noop
      },
      error => {
        expect(error).toBe('Hello');
      }
    );

    expect(timerMock).toHaveBeenCalledTimes(9);
  });

  test("It should retry with exponential backoff if the strategy is 'exponential'", () => {
    const polling$ = polling(throwError('Hello'), {
      interval: 10,
      backoffStrategy: 'exponential',
      exponentialUnit: 10
    });
    polling$.subscribe(
      () => {
        // Noop
      },
      () => {
        // Noop
      }
    );

    // First argument of calls is the delay amount
    const callDelays = timerMock.mock.calls.map(call => call[0]);
    expect(callDelays).toEqual([10, 20, 40, 80, 160, 320, 640, 1280, 2560]);
  });

  test("It should retry with random backoff if the strategy is 'random'", () => {
    const polling$ = polling(throwError('Hello'), {
      interval: 10,
      backoffStrategy: 'random',
      randomRange: [1000, 10000]
    });
    polling$.subscribe(
      () => {
        // Noop
      },
      () => {
        // Noop
      }
    );

    // First argument of calls is the delay amount
    const callDelays = timerMock.mock.calls.map(call => call[0]);
    callDelays.forEach(delay => {
      expect(delay).toBeLessThanOrEqual(10000);
      expect(delay).toBeGreaterThanOrEqual(1000);
    });
  });

  test("It should retry with constant backoff if the strategy is 'consecutive'", () => {
    const polling$ = polling(throwError('Hello'), {
      interval: 10,
      backoffStrategy: 'consecutive',
      constantTime: 1000
    });
    polling$.subscribe(
      () => {
        // Noop
      },
      () => {
        // Noop
      }
    );

    // First argument of calls is the delay amount
    const callDelays = timerMock.mock.calls.map(call => call[0]);
    callDelays.forEach(delay => expect(delay).toBe(1000));
  });
});
