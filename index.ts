import { config } from 'dotenv';
config();

import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { login, fetchMachines } from 'eeproperty-wrapper';

import { CronJob } from 'cron';

const token = process.env.INFLUXDB_TOKEN;

const url = process.env.INFLUXDB_URL as string;

const client = new InfluxDB({ url, token });

let org = `FMEL Machines`
let bucket = `machines`

const sendPoints = () => {

    login(process.env.CODE_IMMEUBLE as string, process.env.CODE_PERSONNEL as string).then((token) => {

        fetchMachines(token).then((machines) => {

            const date = new Date();
            date.setSeconds(0);
            date.setMilliseconds(0);

            let used = 0;
            
            let writeClient = client.getWriteApi(org, bucket, 'ns');
            
            const points = [];

            for (let machine of machines) {
                let point = new Point('machines_a_laver')
                    .timestamp(date)
                    .tag('machine_id', machine.number.toString() + ' ' + machine.room)
                    .intField('status', machine.state === 'ACTIVATED' ? 1 : 0);

                used += machine.state === 'ACTIVATED' ? 1 : 0;

                points.push(point);
                
            }

            console.log('USED', used);

            writeClient.writePoints(points);

            writeClient.flush().then(() => {
                console.log('FINISHED')
            });

        });

    });

}

new CronJob('0 */2 * * * *', () => {

    sendPoints();

}, null, true, 'Europe/Paris');
