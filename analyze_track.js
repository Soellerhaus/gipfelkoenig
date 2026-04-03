const fs = require('fs');
const j = JSON.parse(fs.readFileSync('C:/gipfelkoenig/temp_stream.json', 'utf8'));
const ll = j.find(s => s.type === 'latlng');
if (!ll) { console.log('KEINE GPS DATEN'); process.exit(); }
console.log('GPS Punkte:', ll.data.length);

const peaks = [
  {name: 'Hoher Ifen', lat: 47.3546808, lng: 10.100211},
  {name: 'Walser Hammer', lat: 47.3264552, lng: 10.1995502},
  {name: 'Kuhgehren', lat: 47.3312686, lng: 10.1933969},
  {name: 'Fellhorn', lat: 47.3484, lng: 10.2278},
  {name: 'Ochsenhofer Scharte', lat: 47.3245557, lng: 10.0884992},
  {name: 'Gottesackerscharte', lat: 47.375623, lng: 10.119189}
];

for (const p of peaks) {
  let minD = 99999;
  for (let i = 0; i < ll.data.length; i += 3) {
    const dLat = (ll.data[i][0] - p.lat) * 111000;
    const dLng = (ll.data[i][1] - p.lng) * 111000 * Math.cos(p.lat * Math.PI / 180);
    const d = Math.sqrt(dLat * dLat + dLng * dLng);
    if (d < minD) minD = d;
  }
  console.log(p.name + ': ' + Math.round(minD) + 'm');
}

// Start- und Endpunkt zeigen
console.log('Start:', ll.data[0]);
console.log('Ende:', ll.data[ll.data.length - 1]);

// Bounding box der Tour
let minLat = 999, maxLat = -999, minLng = 999, maxLng = -999;
for (const pt of ll.data) {
  if (pt[0] < minLat) minLat = pt[0];
  if (pt[0] > maxLat) maxLat = pt[0];
  if (pt[1] < minLng) minLng = pt[1];
  if (pt[1] > maxLng) maxLng = pt[1];
}
console.log('Bounding Box:', minLat.toFixed(4), maxLat.toFixed(4), minLng.toFixed(4), maxLng.toFixed(4));
