const {
    LOCAL_ATTENDANCE_THRESHOLD,
    mergedSecondsWithinPlenary,
    calculateLocalAttendance
} = require('../../lib/local_attendance');

// A plenary of one hour, starting at 10:00.
const at = (minutes) => new Date(Date.UTC(2026, 3, 1, 10, 0, 0) + (minutes * 60 * 1000));
const plenary = (id, startsMinute = 0) => ({
    id,
    starts: at(startsMinute),
    ends: at(startsMinute + 60),
    duration: 3600
});
const visit = (applicationId, from, to) => ({
    application_id: applicationId,
    starts: at(from),
    ends: to === null ? null : at(to)
});
const delegate = (id, bodyId) => ({ id, body_id: bodyId, participant_type: 'delegate' });
const antenna = (id) => ({ id, code: 'A' + id, name: 'Antenna ' + id, type: 'antenna' });

describe('Attendance of a Local', () => {
    describe('mergedSecondsWithinPlenary', () => {
        test('counts the time of one visit', () => {
            expect(mergedSecondsWithinPlenary([visit(1, 0, 30)], plenary(1))).toEqual(1800);
        });

        test('counts a moment once when visits overlap', () => {
            const visits = [visit(1, 0, 40), visit(2, 20, 50)];
            expect(mergedSecondsWithinPlenary(visits, plenary(1))).toEqual(50 * 60);
        });

        test('counts a visit that lies inside another visit once', () => {
            const visits = [visit(1, 0, 60), visit(2, 10, 20)];
            expect(mergedSecondsWithinPlenary(visits, plenary(1))).toEqual(3600);
        });

        test('counts visits that touch each other without a gap', () => {
            const visits = [visit(1, 0, 30), visit(2, 30, 60)];
            expect(mergedSecondsWithinPlenary(visits, plenary(1))).toEqual(3600);
        });

        test('does not count the gap between two visits', () => {
            const visits = [visit(1, 0, 10), visit(2, 30, 40)];
            expect(mergedSecondsWithinPlenary(visits, plenary(1))).toEqual(20 * 60);
        });

        test('cuts visits to the time of the plenary', () => {
            const visits = [visit(1, -10, 5), visit(2, 55, 70)];
            expect(mergedSecondsWithinPlenary(visits, plenary(1))).toEqual(10 * 60);
        });

        test('ignores visits outside the plenary', () => {
            const visits = [visit(1, -20, -10), visit(2, 70, 80)];
            expect(mergedSecondsWithinPlenary(visits, plenary(1))).toEqual(0);
        });

        test('ignores visits that are still open', () => {
            const visits = [visit(1, 0, null), visit(2, 0, 15)];
            expect(mergedSecondsWithinPlenary(visits, plenary(1))).toEqual(15 * 60);
        });

        test('does not depend on the order of the visits', () => {
            const visits = [visit(2, 30, 50), visit(1, 0, 40), visit(3, 55, 60)];
            expect(mergedSecondsWithinPlenary(visits, plenary(1))).toEqual(55 * 60);
        });

        test('gives 0 for no visits', () => {
            expect(mergedSecondsWithinPlenary([], plenary(1))).toEqual(0);
        });
    });

    describe('calculateLocalAttendance', () => {
        const calculate = (options) => calculateLocalAttendance({
            plenaries: [],
            applications: [],
            bodies: [antenna(1)],
            ...options
        });

        test('uses the threshold of 80 percent', () => {
            expect(LOCAL_ATTENDANCE_THRESHOLD).toEqual(80);
        });

        test('gives 100% to a Local when one delegate is there the whole time and the other is not', () => {
            // Anna is in the hall for the full plenary, Bram is in a workshop.
            const p = plenary(1);
            const result = calculate({
                plenaries: [{ ...p, attendances: [visit(10, 0, 60)] }],
                applications: [delegate(10, 1), delegate(11, 1)]
            });

            expect(result.locals[0].delegates).toEqual(2);
            expect(result.locals[0].plenaries).toEqual([{ plenary_id: 1, seconds: 3600, percent: 100 }]);
            expect(result.locals[0].average_percent).toEqual(100);
            expect(result.locals[0].below_threshold).toEqual(false);
        });

        test('does not lower the score of a Local that sends more delegates', () => {
            const p = plenary(1);
            const attendances = [visit(10, 0, 60)];

            const withOne = calculate({
                plenaries: [{ ...p, attendances }],
                applications: [delegate(10, 1)]
            });
            const withThree = calculate({
                plenaries: [{ ...p, attendances }],
                applications: [delegate(10, 1), delegate(11, 1), delegate(12, 1)]
            });

            expect(withThree.locals[0].average_percent).toEqual(withOne.locals[0].average_percent);
        });

        test('counts a moment when at least one delegate is in the hall', () => {
            // Together the two delegates cover 0-30 and 20-50: 50 of 60 minutes.
            const result = calculate({
                plenaries: [{ ...plenary(1), attendances: [visit(10, 0, 30), visit(11, 20, 50)] }],
                applications: [delegate(10, 1), delegate(11, 1)]
            });

            expect(result.locals[0].plenaries[0].seconds).toEqual(50 * 60);
            expect(result.locals[0].plenaries[0].percent).toBeCloseTo(83.3333, 3);
            expect(result.locals[0].below_threshold).toEqual(false);
        });

        test('does not merge the visits of delegates of different Locals', () => {
            const result = calculate({
                bodies: [antenna(1), antenna(2)],
                plenaries: [{ ...plenary(1), attendances: [visit(10, 0, 30), visit(20, 30, 60)] }],
                applications: [delegate(10, 1), delegate(20, 2)]
            });

            expect(result.locals.map((local) => local.average_percent)).toEqual([50, 50]);
        });

        test('gives every plenary the same weight, whatever its duration', () => {
            // A short plenary of 10 minutes with full attendance, a long one of 60 minutes with none.
            const short = { id: 1, starts: at(0), ends: at(10), duration: 600 };
            const long = { ...plenary(2, 100), attendances: [] };
            const result = calculate({
                plenaries: [{ ...short, attendances: [visit(10, 0, 10)] }, long],
                applications: [delegate(10, 1)]
            });

            expect(result.locals[0].plenaries.map((entry) => entry.percent)).toEqual([100, 0]);
            expect(result.locals[0].average_percent).toEqual(50);
        });

        test('marks a Local below 80% and not a Local at exactly 80%', () => {
            const result = calculate({
                bodies: [antenna(1), antenna(2)],
                plenaries: [{ ...plenary(1), attendances: [visit(10, 0, 48), visit(20, 0, 47)] }],
                applications: [delegate(10, 1), delegate(20, 2)]
            });

            expect(result.locals[0].average_percent).toEqual(80);
            expect(result.locals[0].below_threshold).toEqual(false);
            expect(result.locals[1].average_percent).toBeCloseTo(78.3333, 3);
            expect(result.locals[1].below_threshold).toEqual(true);
        });

        test('gives a Local without delegates 0% and marks it', () => {
            const result = calculate({ plenaries: [{ ...plenary(1), attendances: [] }] });

            expect(result.locals[0].delegates).toEqual(0);
            expect(result.locals[0].average_percent).toEqual(0);
            expect(result.locals[0].below_threshold).toEqual(true);
        });

        test('does not mark a Local when there is no plenary to judge', () => {
            const result = calculate({ applications: [delegate(10, 1)] });

            expect(result.locals[0].plenaries).toEqual([]);
            expect(result.locals[0].average_percent).toEqual(0);
            expect(result.locals[0].below_threshold).toEqual(false);
        });

        test('lists only Antennae', () => {
            const result = calculate({
                bodies: [
                    antenna(1),
                    { id: 2, type: 'contact antenna' },
                    { id: 3, type: 'commission' }
                ]
            });

            expect(result.locals.map((local) => local.body_id)).toEqual([1]);
        });

        test('counts only delegates of the Local, not envoys or delegates of other Locals', () => {
            const result = calculate({
                plenaries: [{ ...plenary(1), attendances: [visit(11, 0, 60), visit(12, 0, 60)] }],
                applications: [
                    delegate(10, 1),
                    { id: 11, body_id: 1, participant_type: 'envoy' },
                    delegate(12, 2)
                ]
            });

            expect(result.locals[0].delegates).toEqual(1);
            expect(result.locals[0].average_percent).toEqual(0);
        });

        test('reports the threshold next to the Locals', () => {
            expect(calculate({}).threshold).toEqual(80);
        });
    });
});
