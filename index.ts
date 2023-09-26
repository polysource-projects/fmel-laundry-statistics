import { config } from 'dotenv';
config();

import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { login, fetchMachines } from 'eeproperty-wrapper';

const token = process.env.INFLUXDB_TOKEN;

const url = 'http://localhost:8086'

const client = new InfluxDB({ url, token });

let org = `FMEL Machines`
let bucket = `machines`

const sendPoints = () => {


login(process.env.CODE_IMMEUBLE as string, process.env.CODE_PERSONNEL as string).then((token) => {

    fetchMachines(token).then((machines) => {

        let used = 0;
        
        let writeClient = client.getWriteApi(org, bucket, 'ns');

        for (let machine of machines) {
            let point = new Point('machines_a_laver')
                .tag('machine_id', machine.number.toString() + ' ' + machine.room)
                .intField('status', machine.state === 'ACTIVATED' ? 1 : 0);

            used += machine.state === 'ACTIVATED' ? 1 : 0;
            
            writeClient.writePoint(point);
        }

        console.log('USED', used);

        writeClient.flush().then(() => {
            console.log('FINISHED')
        });

    });

});

}

setInterval(() => {
    sendPoints();
}, 10_000);