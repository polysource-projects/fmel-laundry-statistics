const { InfluxDB } = require('@influxdata/influxdb-client');
require('dotenv').config();

const chalk = require('chalk');

const url = process.env.INFLUXDB_URL;
const token = process.env.INFLUXDB_TOKEN;
const org = `FMEL Machines`;
const bucket = `machines`;

const client = new InfluxDB({ url, token });
const queryApi = client.getQueryApi(org);

const simpleQuery = `
from(bucket: "${bucket}")
  |> range(start: -40d)
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
{ "Atrium F" : { "2020-12-01": 2.5 } }
*/
const machinesUses = {};

const formatMachineId = (machineId) => {
	const idx = machineId.split(' ')[0];
	const letter = machineId.split(' ')[2];
	return `Atrium ${idx} (${letter})`;
}

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

				const date = new Date(row._time);
				const resetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());


				// Calcul les tranches d'utilisation de chaque machine

				const machineId = formatMachineId(row.machine_id);

				if (!machinesUses[machineId]) {
					machinesUses[machineId] = {};
				}

				if (!machinesUses[machineId][resetDate.toISOString()]) {
					machinesUses[machineId][resetDate.toISOString()] = 0;
				}

				if (row._value == 1) {
					machinesUses[machineId][resetDate.toISOString()] += 2;
				}

				// Maintenant, on veut compter le nombre de dimanche, de lundi, etc. qui passent
				// Ce sera utile pour faire une moyenne cohérente à la fin

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
				Object.keys(machinesUses[machineId]).forEach((dateS) => {
					const date = new Date(dateS);
					const resetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
					if (!hourCountPerDayOfWeek[resetDate.getDay()]) {
						hourCountPerDayOfWeek[resetDate.getDay()] = 0;
					}
					hourCountPerDayOfWeek[resetDate.getDay()] += machinesUses[machineId][dateS] / 60;
				});
			});

			// moyenne par jour
			const weekOfDaysNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
			Object.keys(hourCountPerDayOfWeek).forEach((day) => {
				console.log(weekOfDaysNames[day] + ' : ' + (hourCountPerDayOfWeek[day] / countPerDays[day]).toFixed(2) + 'h');
			});
			console.log(machinesUses);
			console.log(countPerDays);
			console.log(hourCountPerDayOfWeek);

			console.log(chalk.yellow(`Processed ${rawData.length} points from InfluxDB.`));

			console.log('\n');

			for (let i = 1; i <= 7; i++) {
				const weekOfDayIndex = i % 7;
				const weekOfDay = weekOfDaysNames[weekOfDayIndex];

				const averageHourCount = Math.round(hourCountPerDayOfWeek[weekOfDayIndex] / countPerDays[weekOfDayIndex]);
				const totalHourCount = (22 - 7);
				const totalMachinesAvailable = Object.keys(machinesUses).length;
				const totalHourCountForAllMachines = totalHourCount * totalMachinesAvailable;
				const percentage = Math.round(averageHourCount / totalHourCountForAllMachines * 100);

				const color = percentage > 50 ? percentage > 100 ? 'red' : 'yellow' : 'green';

				console.log(`Les machines à laver sont utilisées, en moyenne, ${averageHourCount}h le ${chalk.cyan(weekOfDay)} (${chalk[color](percentage)}%)`);

			}

			console.log('\n');

			let batF = 0;
			let batG = 0;

			let machinesBatF = Object.keys(machinesUses).filter((machineId) => machineId.includes('F')).length;
			let machinesBatG = Object.keys(machinesUses).filter((machineId) => machineId.includes('G')).length;

			for (let i = 0; i < Object.keys(machinesUses).length; i++) {
				const machineId = Object.keys(machinesUses)[i];
				const machineUses = machinesUses[machineId];
				const hourUsedTotal = Math.round(Object.values(machineUses).reduce((acc, val) => acc + val, 0) / 60 * 100) / 100;
				const hourUsedPerDay = Math.ceil(hourUsedTotal / countedDates.length * 100) / 100;
				const totalHourCount = (22 - 7);
				const percentage = Math.round((hourUsedPerDay) / totalHourCount * 100);
				const color = percentage > 50 ? percentage > 100 ? 'red' : 'yellow' : 'green';
				if (machineId.includes('F')) {
					batF += hourUsedTotal;
				} else {
					batG += hourUsedTotal;
				}
				console.log(`La machine à laver ${chalk.magenta(machineId)} est indisponible ${hourUsedPerDay}h chaque jour (${chalk[color](percentage)}%)`);
			}

			console.log('\n');

			const totalHourCountF = (22 - 7) * machinesBatF;
			const totalHourCountG = (22 - 7) * machinesBatG;

			const hourUsedPerDayF = Math.ceil(batF / countedDates.length);
			const hourUsedPerDayG = Math.ceil(batG / countedDates.length);

			const percentageF = Math.round((hourUsedPerDayF) / totalHourCountF * 100);
			const percentageG = Math.round((hourUsedPerDayG) / totalHourCountG * 100);

			const colorF = percentageF > 50 ? percentageF > 100 ? 'red' : 'yellow' : 'green';
			const colorG = percentageG > 50 ? percentageG > 100 ? 'red' : 'yellow' : 'green';

			console.log(`La buanderie F est indisponible ${hourUsedPerDayF}h chaque jour (${chalk[colorF](percentageF)}%)`);
			console.log(`Le buanderie G est indisponible ${hourUsedPerDayG}h chaque jour (${chalk[colorG](percentageG)}%)`);


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


