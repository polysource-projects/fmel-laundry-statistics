const { InfluxDB } = require('@influxdata/influxdb-client');
require('dotenv').config();

const url = process.env.INFLUXDB_URL;
const token = process.env.INFLUXDB_TOKEN;
const org = `FMEL Machines`;
const bucket = `machines`;

const client = new InfluxDB({ url, token });
const queryApi = client.getQueryApi(org);

const simpleQuery = `
from(bucket: "${bucket}")
  |> range(start: -10d)
  |> sort(columns: ["_time"])
`;

console.time('processing');

const rawData = [];

// on veut compter le nombre de dimanche, de lundi, etc. qui passent
// pour faire une moyenne cohérente à la fin
const countPerDays = {};
const countedDates = [];

// on veut créer des entrées pour chaque machine, par jour
// de la forme
/*
{ "Atrium F" : [
	{
	  start: ISOStringDate,
	  end: ISOStringDate,
	  duration: Number
	},
  ]
}
*/
const machinesUses = {};

queryApi.queryRows(simpleQuery, {
	next(row, tableMeta) {
		const o = tableMeta.toObject(row);
		rawData.push(o);

	},
	error(error) {
		console.error(error);
		console.log('ERROR');
	},
	complete() {
		console.log('Simple query completed');

		console.log(rawData.length + ' rows');

		rawData
			.sort((a, b) => {
				if (a.machine_id === b.machine_id) {
					return new Date(a._time) - new Date(b._time);
				}
				return a.machine_id.localeCompare(b.machine_id);
			})
			.forEach((row) => {


				// Calcul les tranches d'utilisation de chaque machine

				if (!machinesUses[row.machine_id]) {
					machinesUses[row.machine_id] = [];
				}

				const machineUses = machinesUses[row.machine_id];

				if (row._value == 0) {
					const lastUsagePeriod = machineUses[machineUses.length - 1];
					if (lastUsagePeriod && !lastUsagePeriod.end) {
						lastUsagePeriod.end = row._time;
						lastUsagePeriod.duration = parseFloat(((new Date(lastUsagePeriod.end) - new Date(lastUsagePeriod.start)) / 1000 / 60 / 60).toFixed(2));
					}
				} else {
					const lastUsagePeriod = machineUses[machineUses.length - 1];
					if (!lastUsagePeriod || lastUsagePeriod.end) {
						machinesUses[row.machine_id].push({ start: row._time, end: null });
					}
				}



				// Maintenant, on veut compter le nombre de dimanche, de lundi, etc. qui passent
				// Ce sera utile pour faire une moyenne cohérente à la fin

				const date = new Date(row._time);
				const resetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
				if (!countedDates.includes(resetDate.toISOString())) {
					countedDates.push(resetDate.toISOString());
					if (!countPerDays[date.getDay()]) {
						countPerDays[date.getDay()] = 0;
					}
					countPerDays[date.getDay()]++;
				}

			});


			// Une fois qu'on a toutes les tranches d'utilisation de chaque machine
			// On veut les sommer par jour

			const hourCountPerDayOfWeek = {};

			Object.keys(machinesUses).forEach((machineId) => {
				const machineUses = machinesUses[machineId];
				machineUses.forEach((usagePeriod) => {
					const date = new Date(usagePeriod.start);
					const resetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
					if (!hourCountPerDayOfWeek[resetDate.getDay()]) {
						hourCountPerDayOfWeek[resetDate.getDay()] = 0;
					}
					hourCountPerDayOfWeek[resetDate.getDay()] += usagePeriod.duration;
				});
			});

			console.log(machinesUses);
			console.log(countPerDays);
			console.log(hourCountPerDayOfWeek);


		/*

    const hourUsagePerDay = {}; // { machine_id: [{ date: Date, hourCount: Number }] }

    Object.keys(usagePeriods).forEach((machineId) => {
      const machineUsagePeriods = usagePeriods[machineId];
      machineUsagePeriods.forEach((usagePeriod) => {
        const start = new Date(usagePeriod.start);
        const end = new Date(usagePeriod.end || new Date());
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const usage = (end - start) / 1000 / 60 / 60;
        const hourUsage = { date, usage };
        if (!hourUsagePerDay[machineId]) {
          hourUsagePerDay[machineId] = [];
        }
        if (!hourUsagePerDay[machineId][date.toISOString()]) {
          hourUsagePerDay[machineId][date.toISOString()] = 0;
        }
        hourUsagePerDay[machineId][date.toISOString()] += usage;
      });
    });

    console.log(hourUsagePerDay);

    const weekOfDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const weekOfDaysCount = {};
    const dayUsagePerDay = {}; // {Sunday: hourCount, Monday: hourCount, ...}

    Object.keys(hourUsagePerDay).forEach((machineId) => {
      const machineHourUsagePerDay = hourUsagePerDay[machineId];
      Object.keys(machineHourUsagePerDay).forEach((date) => {
        const day = new Date(date).getDay();
        if (!dayUsagePerDay[weekOfDays[day]]) {
          dayUsagePerDay[weekOfDays[day]] = 0;
        }
        dayUsagePerDay[weekOfDays[day]] += machineHourUsagePerDay[date];
      });
    });

    console.log(dayUsagePerDay);*/

	},
});


