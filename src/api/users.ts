/**
 * @module api/users
 *
 * User profile data access layer. Provides lookups for user metadata (name,
 * username, bio), full-name resolution by user id, and a batch endpoint for
 * fetching multiple users' names and profile pictures in a single request with
 * PII-safe guards.
 *
 * Depends on: ./index (supabase client)
 * Used by: hooks.ts, AppSidebar
 */
import { User } from "@supabase/supabase-js";
import { supabase } from ".";

/** Safe default when user row is missing or metadata fetch fails. */
export const ANONYMOUS_USER_METADATA: TUserDetails = {
    first_name: "Anonymous",
    last_name: "",
    username: "anonymous",
    bio: "",
    created_at: "",
};

/**
 * Resolves a user's full name ("First Last") from a user UUID.
 * Falls back to "Anonymous" if data is missing.
 *
 * @param id - A user UUID
 * @returns The full name string, or "Anonymous"
 */
export const getUserFullName = async (id: string | number | undefined) => {
    try {
        if (!id) {
            return "Anonymous";
        }

        const userId = typeof id === "string" ? id : id.toString();

        const { data: fullName, error: fullNameError } = await supabase
            .from("users")
            .select("first_name,last_name")
            .eq("id", userId);

        if (fullNameError) {
            console.error("Error fetching users full name:", fullNameError);
            return "Anonymous";
        }
        if (
            fullName
            && fullName.length > 0
            && fullName[0].first_name
            && fullName[0].last_name
            && fullName[0].first_name !== null
            && fullName[0].last_name !== null
        ) {
            return fullName[0].first_name + " " + fullName[0].last_name;
        }
        return "Anonymous";
    } catch (error) {
        console.error("Error fetching users full name", error);
        return "Anonymous";
    }
};

/**
 * Fetches a user's public profile metadata: first name, last name, username,
 * bio, and account creation date.
 *
 * @param id - The user's UUID
 * @returns The user's metadata as a TUserDetails object, or anonymous defaults on error / missing row
 */
export const getUserMetaData = async (id: string) => {
    try {
        const { data: metaData, error: metaDataError } = await supabase
            .from("users")
            .select("first_name,last_name,username,bio,created_at")
            .eq("id", id);

        if (metaDataError) {
            console.error("Error fetching users metadata", metaDataError);
            return ANONYMOUS_USER_METADATA;
        }
        if (metaData && metaData.length > 0) {
            return metaData[0] as TUserDetails;
        }
        return ANONYMOUS_USER_METADATA;
    } catch (error) {
        console.error("Error fetching users metadata", error);
        return ANONYMOUS_USER_METADATA;
    }
};

/**
 * Updates a user's public profile metadata. Caller must be the authenticated user.
 *
 * @param user - Supabase User (must match the row being updated)
 * @param firstName - First name
 * @param lastName - Last name
 * @param userName - Username
 * @param bio - Bio text
 * @param timezone - Optional timezone string (e.g. from Intl.DateTimeFormat().resolvedOptions().timeZone)
 * @throws On Supabase error so caller can show toast
 */
export const updateUserMetadataPublic = async (
    user: User,
    firstName: string,
    lastName: string,
    userName: string,
    bio: string,
    timezone?: string,
) => {
    const payload: Record<string, string> = {
        first_name: firstName,
        last_name: lastName,
        username: userName,
        bio: bio ?? "",
    };
    if (timezone !== undefined && timezone !== "") {
        payload.timezone = timezone;
    }
    const { error } = await supabase
        .from("users")
        .update(payload)
        .eq("id", user.id);

    if (error) {
        console.error("Error updating user metadata", error);
        throw error;
    }
};

/**
 * GETS USER METADATA AND PROFILE PICTURES FOR MULTIPLE USERS IN BATCH
 *
 * PII EXPOSURE POLICY:
 * - ONLY exposes: first_name, last_name (combined as fullName), and profile pictures
 * - DOES NOT expose: email, username, bio, created_at, or any other PII
 * - Returns "Anonymous" if name data is missing or null
 * - Profile pictures are user-uploaded content (users consent by uploading)
 *
 * SECURITY SAFEGUARDS:
 * - Explicit field selection (only id, first_name, last_name)
 * - Input validation (filters invalid/empty IDs)
 * - No PII in error logs (only user IDs, never names/emails)
 * - Returns empty object on any error (fail-safe)
 */
export const getUsersBatch = async (
    userIds: string[],
): Promise<Record<string, { fullName: string; profilePic: Blob | null }>> => {
    try {
        const uniqueUserIds = Array.from(new Set(
            userIds.filter(id =>
                id
                && typeof id === "string"
                && id.length > 0
                && id.length <= 100
                && /^[a-zA-Z0-9\-_]+$/.test(id)
            ),
        ));

        if (uniqueUserIds.length === 0) {
            return {};
        }

        const limitedUserIds = uniqueUserIds.slice(0, 100);

        const { data: usersData, error: usersError } = await supabase
            .from("users")
            .select("id, first_name, last_name")
            .in("id", limitedUserIds);

        if (usersError) {
            console.error("Error fetching users batch metadata:", usersError.message);
            return {};
        }

        const userDataMap: Record<string, { fullName: string; profilePic: Blob | null }> = {};

        limitedUserIds.forEach(id => {
            userDataMap[id] = { fullName: "Anonymous", profilePic: null };
        });

        if (usersData && usersData.length > 0) {
            const profilePicPromises = usersData.map(async (user) => {
                let fullName = "Anonymous";
                if (
                    user.first_name
                    && user.last_name
                    && typeof user.first_name === "string"
                    && typeof user.last_name === "string"
                    && user.first_name.trim().length > 0
                    && user.last_name.trim().length > 0
                ) {
                    fullName = `${user.first_name.trim()} ${user.last_name.trim()}`;
                }

                let profilePic: Blob | null = null;
                try {
                    if (user.id && typeof user.id === "string" && /^[a-zA-Z0-9\-_]+$/.test(user.id)) {
                        const { data: profilePicData, error: profilePicError } = await supabase.storage
                            .from("profile_pictures")
                            .list(user.id, { limit: 1, sortBy: { column: "name", order: "asc" } });

                        if (!profilePicError && profilePicData && profilePicData.length > 0) {
                            const fileName = profilePicData[0].name;
                            if (fileName && typeof fileName === "string" && fileName.length < 255) {
                                const { data: picData, error: downloadError } = await supabase.storage
                                    .from("profile_pictures")
                                    .download(`${user.id}/${fileName}`);

                                if (!downloadError && picData) {
                                    profilePic = picData;
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error(
                        "Error fetching profile picture (user ID redacted):",
                        error instanceof Error ? error.message : "Unknown error",
                    );
                }

                return { userId: user.id, fullName, profilePic };
            });

            const results = await Promise.all(profilePicPromises);
            results.forEach(({ userId, fullName, profilePic }) => {
                if (userId && typeof userId === "string") {
                    userDataMap[userId] = { fullName, profilePic };
                }
            });
        }

        return userDataMap;
    } catch (error) {
        console.error(
            "Error fetching users batch (no PII exposed):",
            error instanceof Error ? error.message : "Unknown error",
        );
        return {};
    }
};
