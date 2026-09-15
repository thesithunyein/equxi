/**
 * Type declarations for `api/trust.js`.
 *
 * At runtime the module exports a callable function (the Vercel handler) that
 * also carries its helpers as properties. A `function` declaration merged with
 * a `namespace` describes exactly that, and unlike a bare `const` it makes the
 * interfaces importable as `trust.FetchImpl`, `trust.ApiPayload`, and so on.
 */
import EquxiLayout = require("../lib/equxi-layout");

declare function trust(req: trust.Request, res: trust.Response): Promise<void>;

declare namespace trust {
  /** Just enough of the Fetch API for the RPC call to be driven from a stub. */
  type FetchImpl = (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string }
  ) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<{ result?: unknown; error?: { message?: string } }>;
  }>;

  type RpcCall = (method: string, params: unknown[]) => Promise<unknown>;

  interface Query {
    agent?: string;
    owner?: string;
    cluster?: string;
    rpc?: string;
  }

  /** One decoded agent plus its joined bond, slashes, constraints and profile. */
  interface ApiAgent {
    address: string;
    name: string;
    owner: string;
    agentType: string;
    status: string;
    /** Which on-chain layout the Agent account was written with. */
    layout: "v1" | "v2";
    constraintCount: number;
    createdAt: number;
    constraints: Array<{
      type: string;
      isEnforced: boolean;
      params: EquxiLayout.ConstraintParamsAccount;
    }>;
    profile: EquxiLayout.TrustProfileResult;
  }

  interface ApiPayload {
    ok: true;
    cluster: string;
    program: string;
    generatedAt: number;
    /** Program-level caveats, such as a deployment predating the v0.2 layout. */
    warnings: string[];
    counts: { agents: number; bonds: number; slashes: number; constraints: number };
    totals: {
      slashCount: number;
      openSlashes: number;
      bondedLamports: string;
      bondedSol: number;
    };
    vault: EquxiLayout.VaultAccount | null;
    agents: ApiAgent[];
  }

  interface BuildResponseDeps {
    fetchImpl: FetchImpl;
    now: number;
  }

  interface Located<T = unknown> {
    address: string;
    data: T;
  }

  interface Request {
    method: string;
    query?: Record<string, string>;
  }

  interface Response {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string) => void;
  }

  function buildResponse(query: Query, deps: BuildResponseDeps): Promise<ApiPayload>;

  function createRpc(rpcUrl: string, fetchImpl: FetchImpl): RpcCall;

  function assembleRegistry(
    agents: Array<Located>,
    bonds: Array<Located>,
    slashes: Array<Located>,
    constraints: Array<Located>,
    now: number
  ): ApiAgent[];

  function fetchAccounts(call: RpcCall, name: string, extraFilters?: unknown[]): Promise<Array<Located>>;

  function fetchOne(call: RpcCall, address: string, name: string): Promise<Located | null>;
}

export = trust;
