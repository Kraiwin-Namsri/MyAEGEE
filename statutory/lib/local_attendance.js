// How long a Local was represented in the plenaries.
//
// General Rules, art. 6(1)(d): to remain an Antenna, a Local must be represented by its delegates
// in at least 80% of plenary time. The rule is about the Local, not about each delegate:
// a moment counts when at least one delegate of the Local is in the hall.
// Contact Antennae have no attendance criterion, so only Antennae are calculated.

const LOCAL_ATTENDANCE_THRESHOLD = 80;

// The seconds of a plenary in which at least one of the visits was running.
// Visits are cut to the plenary time and overlapping visits are merged, so a moment counts once.
// A visit that is not closed yet has no end and counts for nothing, as in the rest of the export.
const mergedSecondsWithinPlenary = (attendances, plenary) => {
    const plenaryStart = new Date(plenary.starts).getTime();
    const plenaryEnd = new Date(plenary.ends).getTime();

    const ranges = attendances
        .filter((attendance) => attendance.ends)
        .map((attendance) => ({
            start: Math.max(new Date(attendance.starts).getTime(), plenaryStart),
            end: Math.min(new Date(attendance.ends).getTime(), plenaryEnd)
        }))
        .filter((range) => range.end > range.start)
        .sort((a, b) => a.start - b.start);

    let milliseconds = 0;
    let coveredUntil = -Infinity;
    for (const range of ranges) {
        const start = Math.max(range.start, coveredUntil);
        if (range.end > start) {
            milliseconds += range.end - start;
            coveredUntil = range.end;
        }
    }

    return milliseconds / 1000;
};

// Per Antenna: the percentage of each plenary in which the Local was represented,
// and the average over all plenaries. Every plenary has the same weight, whatever its duration.
// Plenaries must be loaded with their attendances.
const calculateLocalAttendance = ({ plenaries, applications, bodies }) => {
    const locals = bodies
        .filter((body) => body.type === 'antenna')
        .map((body) => {
            const delegateIds = new Set(applications
                .filter((application) => application.body_id === body.id && application.participant_type === 'delegate')
                .map((application) => application.id));

            const perPlenary = plenaries.map((plenary) => {
                const visits = plenary.attendances.filter((attendance) => delegateIds.has(attendance.application_id));
                const seconds = mergedSecondsWithinPlenary(visits, plenary);

                return {
                    plenary_id: plenary.id,
                    seconds,
                    percent: (seconds / plenary.duration) * 100
                };
            });

            const averagePercent = plenaries.length > 0
                ? perPlenary.reduce((sum, entry) => sum + entry.percent, 0) / plenaries.length
                : 0;

            return {
                body_id: body.id,
                code: body.code,
                name: body.name,
                delegates: delegateIds.size,
                plenaries: perPlenary,
                average_percent: averagePercent,
                // Without any plenary there is nothing to judge yet.
                below_threshold: plenaries.length > 0 && averagePercent < LOCAL_ATTENDANCE_THRESHOLD
            };
        });

    return { threshold: LOCAL_ATTENDANCE_THRESHOLD, locals };
};

module.exports = {
    LOCAL_ATTENDANCE_THRESHOLD,
    mergedSecondsWithinPlenary,
    calculateLocalAttendance
};
