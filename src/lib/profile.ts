import { useLocalText } from "./local-flag";

const PROFILE_NAME_KEY = "ainsley:profile-name";

/** The student's name, set in Settings and shown in the sidebar (on this device only). */
export function useProfileName() {
  const [name, setName] = useLocalText(PROFILE_NAME_KEY);
  const displayName = name.trim() || "Guest";
  return { name, setName, displayName, initial: displayName[0].toUpperCase() };
}
