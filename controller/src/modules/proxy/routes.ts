import type { RouteRegistrar } from "../../http/route-registrar";
import { registerOpenAIRoutes } from "./openai-routes";
import { registerTokenizationRoutes } from "./tokenization-routes";
import { registerChatTitleRoutes } from "./chat-title-routes";

export const registerAllProxyRoutes: RouteRegistrar = (app, context) => {
  registerOpenAIRoutes(app, context);
  registerTokenizationRoutes(app, context);
  registerChatTitleRoutes(app, context);
};
