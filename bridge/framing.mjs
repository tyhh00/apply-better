// Chrome native messaging framing: uint32 little-endian length + UTF-8 JSON.

export function encode(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Returns a stdin 'data' handler that calls onMessage once per complete frame. */
export function decoder(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const body = buf.subarray(4, 4 + len).toString("utf8");
      buf = buf.subarray(4 + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      onMessage(msg);
    }
  };
}
