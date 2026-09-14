/**
 * Multi-Node IoT River Sensor Simulator
 * Spawns N simulated river monitoring nodes simultaneously.
 * 
 * Usage:
 *   node simulate-nodes.js [numNodes] [intervalSecs]
 * 
 * Examples:
 *   node simulate-nodes.js 5 2      (Spawns 5 river nodes publishing every 2 seconds)
 *   node simulate-nodes.js 10 60    (Spawns 10 river nodes publishing every 60 seconds)
 */

const { fork } = require('child_process');
const path = require('path');

const numNodes = parseInt(process.argv[2] || '4', 10);
const intervalSecs = parseInt(process.argv[3] || '5', 10);
const broker = process.env.BROKER || 'minikube';

const rivers = [
  { id: 'thames-01', name: 'River Thames (London Node #1)' },
  { id: 'severn-02', name: 'River Severn (Gloucester Node #2)' },
  { id: 'trent-03', name: 'River Trent (Nottingham Node #3)' },
  { id: 'mersey-04', name: 'River Mersey (Liverpool Node #4)' },
  { id: 'tyne-05', name: 'River Tyne (Newcastle Node #5)' },
  { id: 'clyde-06', name: 'River Clyde (Glasgow Node #6)' },
  { id: 'avon-07', name: 'River Avon (Bristol Node #7)' },
  { id: 'ouse-08', name: 'River Ouse (York Node #8)' }
];

console.log('===========================================================');
console.log(` HydroSense Multi-Node IoT Simulator`);
console.log(` Spawning ${numNodes} simulated river nodes publishing every ${intervalSecs}s`);
console.log(` Target Broker: ${broker}`);
console.log(' Press Ctrl+C to terminate all simulated nodes');
console.log('===========================================================');

const children = [];

for (let i = 0; i < numNodes; i++) {
  const riverObj = rivers[i % rivers.length];
  const riverId = `${riverObj.id}-sim${Math.floor(i / rivers.length) + 1}`;

  const env = {
    ...process.env,
    RIVER_ID: riverId,
    INTERVAL_SECS: intervalSecs.toString(),
    BROKER: broker
  };

  const child = fork(path.join(__dirname, 'index.js'), [], { env });
  children.push(child);
}

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log('\nShutting down all simulated IoT nodes...');
  children.forEach(child => child.kill('SIGINT'));
  process.exit(0);
});
