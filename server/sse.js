const HEARTBEAT_MS = 15000;

export const openEventStream = (res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  res.on('close', () => clearInterval(heartbeat));

  return {
    send(event, data) {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
};
