// shared/main-world-rpc.ts

export const MAIN_WORLD_RPC_TYPE = 'rtrvr:mainWorldRpc';

// ---------------------------------------------------------------------------
// Frame utilities RPCs (no new permissions)
// ---------------------------------------------------------------------------
// Used by content scripts to:
//  - learn their Chrome frameId (sender.frameId)
//  - relay an action message to a different frame via the background
export const FRAME_ID_RPC_TYPE = 'rtrvr:frameId';
export const RELAY_TO_FRAME_RPC_TYPE = 'rtrvr:relayToFrame';
// Frame ping: map a DOM iframe -> Chrome frameId (minimal info only)
export const FRAME_PING_REGISTER_RPC_TYPE = 'rtrvr:framePingRegister';
export const FRAME_PING_RETURN_RPC_TYPE = 'rtrvr:framePingReturn';
export const FRAME_PING_RESOLVED_MSG_TYPE = 'rtrvr:framePingResolved';

// Frame tree request (payload travels ONLY via runtime messaging)
export const GET_FRAME_TREE_MSG_TYPE = 'rtrvr:getFrameTree';

export type MainWorldRpcRequest =
  | { kind: 'flushScan'; options: any }
  | { kind: 'scroll'; command: any }
  | { kind: 'action'; request: any };

type RpcOk = { ok: true; result: any };
type RpcErr = { ok: false; error: string };

export async function callMainWorld<T = any>(payload: MainWorldRpcRequest): Promise<T> {
  const res = await new Promise<RpcOk | RpcErr>(resolve => {
    try {
      chrome.runtime.sendMessage({ type: MAIN_WORLD_RPC_TYPE, payload }, reply => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          resolve({ ok: false, error: lastErr.message || String(lastErr) });
          return;
        }
        resolve(reply as any);
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  if (!res || (res as any).ok !== true) {
    const msg = (res as any)?.error || 'main world rpc failed';
    throw new Error(msg);
  }
  return (res as RpcOk).result as T;
}

export async function callMainWorldWithRetry<T>(payload: MainWorldRpcRequest): Promise<T> {
  try {
    return await callMainWorld<T>(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      /message port closed/i.test(msg) ||
      /receiving end does not exist/i.test(msg) ||
      /context invalidated/i.test(msg) ||
      /extension context invalidated/i.test(msg)
    ) {
      // micro-yield then retry once
      await Promise.resolve();
      return await callMainWorld<T>(payload);
    }
    throw e;
  }
}
