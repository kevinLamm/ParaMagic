// Transport control: no solver work, real browser structured-clone and transfer.
self.onmessage = ({ data }) => {
  if (data.buffer) self.postMessage(data, [data.buffer]);
  else self.postMessage(data);
};
