"use client";

import { createContext, useContext, type ReactNode } from "react";
import api from "@/lib/api/client";
import type { ApiClient } from "@/lib/api/create-api-client";

const ModelManagementApiContext = createContext<ApiClient>(api);

export function ModelManagementApiProvider({
  client,
  children,
}: {
  client: ApiClient;
  children: ReactNode;
}) {
  return (
    <ModelManagementApiContext.Provider value={client}>
      {children}
    </ModelManagementApiContext.Provider>
  );
}

export const useModelManagementApi = (): ApiClient => useContext(ModelManagementApiContext);
