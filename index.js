const { InfluxDB } = require('@influxdata/influxdb-client');
require('dotenv').config();

const chalk = require('chalk');
const { writeFileSync } = require('fs');

const url = process.env.INFLUXDB_URL;
const token = process.env.INFLUXDB_TOKEN;
const org = `FMEL Machines`;
const bucket = `machines`;

const client = new InfluxDB({ url, token });
const queryApi = client.getQueryApi(org);

const simpleQuery = `
from(bucket: "${bucket}")
  |> range(start: 2023-10-01T22:00:00Z, stop: 2023-11-03T23:59:00Z)
  |> sort(columns: ["_time"])
`;

console.time('processing');

const rawData = [];

// on veut compter le nombre de dimanche, de lundi, etc. qui passent
// pour faire une moyenne cohérente à la fin
const countPerDays = {};
const countedDates = [];

let idxToHourDay = null;
let idxToHourMachine = null;
const idxToHour = [];

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

const sumOfUses = (uses) => {
	return uses.reduce((acc, val) => acc + val, 0);
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

				if (!idxToHourMachine) {
					idxToHourMachine = row.machine_id;
					idxToHourDay = resetDate.toISOString();
				}

				if (!machinesUses[machineId][resetDate.toISOString()]) {
					machinesUses[machineId][resetDate.toISOString()] = [];
				}

				if (row._value == 1) {
					machinesUses[machineId][resetDate.toISOString()].push(2);
				} else {
					machinesUses[machineId][resetDate.toISOString()].push(0);
				}

				if (idxToHourMachine === row.machine_id && idxToHourDay === resetDate.toISOString()) {
					idxToHour.push(date.getHours() + " : " + date.getMinutes());
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

		// On supprime la machine Atrium 6 (F)
		// elle était en panne donc elle fausse les résultats
		delete machinesUses['Atrium 6 (F)'];

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
				hourCountPerDayOfWeek[resetDate.getDay()] += sumOfUses(machinesUses[machineId][dateS]) / 60;
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

		let hourUsedTotalF = 0;
		let hourUsedTotalG = 0;

		const machinesBatF = Object.keys(machinesUses).filter((machineId) => machineId.includes('F'));
		const machinesBatG = Object.keys(machinesUses).filter((machineId) => machineId.includes('G'));

		const machinesBatFCount = machinesBatF.length;
		const machinesBatGCount = machinesBatG.length;

		for (let i = 0; i < Object.keys(machinesUses).length; i++) {
			const machineId = Object.keys(machinesUses)[i];
			const machineUses = machinesUses[machineId];
			const hourUsedTotal = Math.round(Object.values(machineUses).reduce((acc, val) => acc + sumOfUses(val), 0) / 60 * 100) / 100;
			const hourUsedPerDay = Math.ceil(hourUsedTotal / countedDates.length * 100) / 100;
			const totalHourCount = (22 - 7);
			const percentage = Math.round((hourUsedPerDay) / totalHourCount * 100);
			const color = percentage > 50 ? percentage > 100 ? 'red' : 'yellow' : 'green';
			if (machineId.includes('F')) {
				hourUsedTotalF += hourUsedTotal;
			} else {
				hourUsedTotalG += hourUsedTotal;
			}
			console.log(`La machine à laver ${chalk.magenta(machineId)} est indisponible ${hourUsedPerDay}h chaque jour (${chalk[color](percentage)}%)`);
		}

		console.log('\n');

		const totalHourCountF = (22 - 7) * machinesBatFCount;
		const totalHourCountG = (22 - 7) * machinesBatGCount;

		const hourUsedPerDayF = Math.ceil(hourUsedTotalF / countedDates.length);
		const hourUsedPerDayG = Math.ceil(hourUsedTotalG / countedDates.length);

		const percentageF = Math.round((hourUsedPerDayF) / totalHourCountF * 100);
		const percentageG = Math.round((hourUsedPerDayG) / totalHourCountG * 100);

		const colorF = percentageF > 50 ? percentageF > 100 ? 'red' : 'yellow' : 'green';
		const colorG = percentageG > 50 ? percentageG > 100 ? 'red' : 'yellow' : 'green';

		console.log(`La buanderie F est indisponible ${hourUsedPerDayF}h chaque jour (${chalk[colorF](percentageF)}%)`);
		console.log(`Le buanderie G est indisponible ${hourUsedPerDayG}h chaque jour (${chalk[colorG](percentageG)}%)`);

		// can be null or 0-6
		const weekOfDay = 6;
		const horairesDouvertureStart = 14;
		const horairesDouvertureEnd = 15;
		const isBetweenHorairesDouverture = (idx) => {
			// idx commence à 0 qui vaut minuit
			// et il y a un idx toutes les deux minutes
			const minutesSinceMidnight = idx * 2;
			const hoursSinceMidnight = Math.floor(minutesSinceMidnight / 60);
			const minutes = minutesSinceMidnight % 60;
			const time = hoursSinceMidnight + minutes / 100;
			return time >= horairesDouvertureStart && time <= horairesDouvertureEnd;
		}

		const startIdx = horairesDouvertureStart * 60 / 2;

		const resultsPerDayPerHour = {};

		const firstMachineId = Object.keys(machinesUses)[0];
		Object.keys(machinesUses[firstMachineId]).forEach((dateS) => {
			const date = new Date(dateS);
			const resetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
			if (!resultsPerDayPerHour[resetDate.toISOString()]) {
				resultsPerDayPerHour[resetDate.toISOString()] = [];
			}
			Object.keys(machinesUses).forEach((machineId) => {
				machinesUses[machineId][resetDate.toISOString()].forEach((minState, idx) => {
					if (!isBetweenHorairesDouverture(idx)) return;
					if (!resultsPerDayPerHour[resetDate.toISOString()][idx - startIdx]) {
						resultsPerDayPerHour[resetDate.toISOString()][idx - startIdx] = 0;
					}
					if (minState === 0) {
						resultsPerDayPerHour[resetDate.toISOString()][idx - startIdx]++;
					}
				});
			});
		});

		//console.log(resultsPerDayPerHour);

		const testDay = resultsPerDayPerHour['2023-10-21T22:00:00.000Z'];

		const averageMachineAvailablePerHour = [];

		function median(values) {

			if (values.length === 0) {
			  throw new Error('Input array is empty');
			}
		  
			// Sorting values, preventing original array
			// from being mutated.
			values = [...values].sort((a, b) => a - b);
		  
			const half = Math.floor(values.length / 2);
		  
			return (values.length % 2
			  ? values[half]
			  : (values[half - 1] + values[half]) / 2
			);
		  
		}

		console.log(median(testDay))

		writeFileSync('./results.json', JSON.stringify(resultsPerDayPerHour, null, 2));
		writeFileSync('./idxToHour.json', JSON.stringify(idxToHour, null, 2));

	},
});


