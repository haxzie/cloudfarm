import type { Db } from "./db";
import type { Auth, Session, User } from "./lib/auth";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Db;
    auth: Auth;
    user: User | null;
    session: Session | null;
  };
};
