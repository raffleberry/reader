/**
 * jsdom's Blob predates `Blob.arrayBuffer()` (browsers have had it since
 * 2020). Shim it with FileReader so tests can read real File objects; the
 * production code is written against the browser API.
 */
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(this);
    });
  };
}

export {};
