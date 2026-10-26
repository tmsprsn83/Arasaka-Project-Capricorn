// Lecture d'un flux SSE (text/event-stream) qui arrive par morceaux : chaque évènement complet est rendu à `onEvent`
// (nom, données JSON). Les commentaires (« : ping ») servent seulement à garder la connexion ouverte.
function createSseParser(onEvent) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let name = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      let value;
      try { value = JSON.parse(data.join('\n')); } catch { continue; }
      onEvent(name, value);
    }
  };
}

module.exports = { createSseParser };
