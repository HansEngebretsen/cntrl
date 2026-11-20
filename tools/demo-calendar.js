// A made-up family calendar for the demo's Google Calendar screen (the real one is private).
// Built around today, so it never runs out. Times are Seattle wall-clock.
const EVENTS = [
  [0, '07:30', '08:15', 'School drop-off'],
  [0, '12:00', '13:00', 'Lunch with Sam'],
  [0, '17:30', '18:30', 'Soccer practice'],
  [1, '09:00', '09:30', 'Dentist'],
  [1, '18:00', '20:00', 'Dinner at the Lees'],
  [2, '10:00', '11:00', 'Farmers market'],
  [2, '19:00', '21:30', 'Kraken game'],
  [3, null, null, 'Library books due'],
  [4, '16:00', '17:00', 'Piano lesson'],
  [5, '08:00', '09:00', 'Run club'],
  [6, '15:00', '17:00', 'Birthday party'],
];
const pad = (n) => String(n).padStart(2, '0');
const offsetHours = (d) => { // Seattle's offset from UTC on that day (PST/PDT)
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName').value;
  return Number((/GMT([+-]\d+)/.exec(s) || [0, -8])[1]);
};
export function demoIcs(now = Date.now()) {
  const day0 = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now) + 'T00:00:00Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//cntrl demo//EN', 'X-WR-CALNAME:Family'];
  EVENTS.forEach(([d, from, to, title], i) => {
    const day = new Date(day0.getTime() + d * 86400e3);
    const ymd = `${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCDate())}`;
    lines.push('BEGIN:VEVENT', `UID:demo-${i}@cntrl`, `SUMMARY:${title}`);
    if (!from) {
      const next = new Date(day.getTime() + 86400e3);
      lines.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`);
    } else {
      const off = offsetHours(day);
      const utc = (hm) => { const [h, m] = hm.split(':').map(Number); const t = new Date(day.getTime() + ((h - off) * 60 + m) * 60e3); return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00Z`; };
      lines.push(`DTSTART:${utc(from)}`, `DTEND:${utc(to)}`);
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
export const isDemoCalendar = (url) => /\/cntrl\/demo-calendar\.ics(\?|$)/.test(url);
