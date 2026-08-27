import { permanentRedirect } from "next/navigation";

export default function RecipesRedirect() {
  permanentRedirect("/settings#models");
}
