import { presetVite } from "@events-ui/config/vite";

export default presetVite({ puerto: 15175, ignorar: ["**/src-tauri/target/**"] });
