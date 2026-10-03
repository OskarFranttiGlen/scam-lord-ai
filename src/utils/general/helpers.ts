/**
 * @module helpers
 *
 * General-purpose utility functions shared across the application:
 * date formatting, workout sorting, Hevy exercise-template lookups
 * from localStorage, AMRAP sentinel conversion, and display-name
 * initial extraction.
 *
 * Depends on: Hevy type definitions (THevyExerciseTemplate, TScheduleWorkouts)
 * Used by: Workout schedule views, exercise cards, artifact-builder UI
 */

/**
 * Format a Supabase ISO-8601 timestamp into a short human-readable date.
 *
 * @param inputDate - ISO date string from Supabase, or `undefined`
 * @returns Formatted date (e.g. "Jan 5, 2025") or empty string if input is falsy
 */
export function convertSupabaseDateToReadable(inputDate: string | undefined): string {

    let formattedDate = "";
    if (inputDate) {
        const date = new Date(inputDate);
        const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
        formattedDate = date.toLocaleDateString('en-US', options);
    }

    return formattedDate;
}



/**
 * Extract up to two uppercase initials from an exercise or user name.
 *
 * @param name - The full name to abbreviate
 * @returns One or two character initials, or `null` for empty/whitespace-only names
 */
export const getInitials = (name: string): string | null => {
    const words = name.trim().split(" ");
    const nonEmpty = words.filter(w => w.length > 0);
    if (nonEmpty.length === 0) return null;
    const initials = nonEmpty.map(word => word[0].toUpperCase());
    if (initials.length > 2) {
        return initials.slice(0, 2).join("");
    }
    return initials.join("");
};

