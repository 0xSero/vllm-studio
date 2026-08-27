import { permanentRedirect } from "next/navigation";

export default function ModelsPage() {
  permanentRedirect("/settings#models");
}
