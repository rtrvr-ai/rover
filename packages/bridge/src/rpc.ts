export type RpcRequest = {
  t: 'req';
  id: string;
  method: string;
  params?: unknown;
};

export type RpcResponse = {
  t: 'res';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: string; data?: unknown };
};

export function bindRpc(
  port: MessagePort,
  handlers: Record<string, (params: any) => any | Promise<any>>,
): void {
  port.onmessage = async ev => {
    const msg = ev.data as RpcRequest;
    if (!msg || msg.t !== 'req') return;

    const { id, method, params } = msg;
    try {
      const fn = handlers[method];
      if (!fn) throw new Error(`No handler for ${method}`);
      const result = await fn(params);
      port.postMessage({ t: 'res', id, ok: true, result } satisfies RpcResponse);
    } catch (err: any) {
      port.postMessage({
        t: 'res',
        id,
        ok: false,
        error: { message: err?.message || String(err) },
      } satisfies RpcResponse);
    }
  };
}
