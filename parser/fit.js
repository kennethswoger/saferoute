// parser/fit.js — FIT binary parsing via fit-file-parser (CDN)
// Returns { points: [[lat, lon], ...], name, fileType }

const FIT_PARSER_CDN = 'https://cdn.jsdelivr.net/npm/fit-file-parser@1.9.0/dist/fit-parser.js';

async function loadFitParser() {
  if (window.FitParser) return window.FitParser;

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = FIT_PARSER_CDN;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load FIT parser from CDN.'));
    document.head.appendChild(script);
  });

  if (!window.FitParser) throw new Error('FitParser not found after CDN load.');
  return window.FitParser;
}

export async function parseFIT(arrayBuffer) {
  const FitParser = await loadFitParser();

  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: 'mph',
      lengthUnit: 'mi',
      elapsedRecordField: true,
    });

    parser.parse(arrayBuffer, (err, data) => {
      if (err) { reject(new Error(`FIT parse error: ${err}`)); return; }

      const records = (data.activity?.sessions ?? [])
        .flatMap(s => s.laps ?? [])
        .flatMap(lap => lap.records ?? []);

      const points = records
        .filter(r => r.position_lat != null && r.position_long != null)
        .map(r => [r.position_lat, r.position_long]);

      if (points.length === 0) throw new Error('No GPS points found in FIT file.');

      const sport = data.activity?.sessions?.[0]?.sport ?? '';
      const name  = sport ? `${sport.charAt(0).toUpperCase()}${sport.slice(1)} Route` : 'FIT Route';

      resolve({ points, name, fileType: 'FIT' });
    });
  });
}
