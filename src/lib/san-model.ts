export type Host = {
  name: string;
  pwwns: string[];
  policy: "round-robin" | "failover";
};
export type Lun = {
  id: number;
  blocks: number;
  online: boolean;
  mappings: Record<string, "rw" | "ro">;
  data: Record<string, string>;
};
export type Storage = {
  name: string;
  pwwns: string[];
  online: boolean;
  luns: Record<number, Lun>;
};
export type IoStats = {
  reads: number;
  writes: number;
  failed: number;
  failovers: number;
  lastPath: string;
  cursor: number;
  lastResult: string;
};
export type SanState = {
  hosts: Record<string, Host>;
  storages: Record<string, Storage>;
  stats: Record<string, IoStats>;
};
export const freshSan = (): SanState => ({
  hosts: {},
  storages: {},
  stats: {},
});
