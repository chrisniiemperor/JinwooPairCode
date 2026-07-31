import express from "express";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import pino from "pino";

import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason,
    delay,
    jidNormalizedUser
} from "@whiskeysockets/baileys";

import pn from "awesome-phonenumber";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| LOGGER
|--------------------------------------------------------------------------
*/

const logger = pino({
    level: process.env.NODE_ENV === "production"
        ? "info"
        : "debug"
});

/*
|--------------------------------------------------------------------------
| SESSION DIRECTORY
|--------------------------------------------------------------------------
*/

const sessionsRoot = path.resolve(
    process.env.SESSION_DIR || "./sessions"
);

fs.mkdirSync(sessionsRoot, {
    recursive: true
});

/*
|--------------------------------------------------------------------------
| ACTIVE SESSIONS
|--------------------------------------------------------------------------
*/

const activeSessions = new Map();

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function normalizeNumber(value) {
    return String(value || "")
        .replace(/\D/g, "");
}

function getSessionPath(number) {
    return path.join(
        sessionsRoot,
        number
    );
}

function removeSession(number) {
    const sessionPath =
        getSessionPath(number);

    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, {
                recursive: true,
                force: true
            });

            console.log(
                `🧹 Removed session: ${number}`
            );
        }
    } catch (error) {
        console.error(
            "❌ Session cleanup error:",
            error
        );
    }
}

/*
|--------------------------------------------------------------------------
| CREATE WHATSAPP SOCKET
|--------------------------------------------------------------------------
*/

async function createSocket(number) {

    const sessionPath =
        getSessionPath(number);

    fs.mkdirSync(sessionPath, {
        recursive: true
    });

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(
        sessionPath
    );

    const {
        version,
        isLatest
    } = await fetchLatestBaileysVersion();

    console.log(
        `📦 Baileys: ${version.join(".")} | Latest: ${isLatest}`
    );

    const socket = makeWASocket({

        version,

        auth: {
            creds: state.creds,

            keys: makeCacheableSignalKeyStore(
                state.keys,
                logger
            )
        },

        logger,

        printQRInTerminal: false,

        browser: Browsers.windows(
            "Chrome"
        ),

        markOnlineOnConnect: false,

        syncFullHistory: false,

        generateHighQualityLinkPreview: false,

        connectTimeoutMs: 60_000,

        defaultQueryTimeoutMs: 60_000,

        keepAliveIntervalMs: 20_000,

        retryRequestDelayMs: 500
    });

    /*
     * Save credentials whenever they change.
     */
    socket.ev.on(
        "creds.update",
        saveCreds
    );

    /*
     |--------------------------------------------------------------------------
     | CONNECTION UPDATE
     |--------------------------------------------------------------------------
     */

    socket.ev.on(
        "connection.update",
        async (update) => {

            const {
                connection,
                lastDisconnect,
                isNewLogin
            } = update;

            console.log(
                `🔄 Connection: ${connection || "unknown"}`
            );

            if (isNewLogin) {
                console.log(
                    "🔐 New WhatsApp login detected."
                );
            }

            /*
             * Successfully connected.
             */
            if (connection === "open") {

                console.log(
                    `✅ JinwooBot connected: ${number}`
                );

                /*
                 * IMPORTANT:
                 *
                 * Give creds.update a moment to finish
                 * writing the latest credentials.
                 */
                await delay(2000);

                try {

                    const sessionPath =
                        getSessionPath(number);

                    const credsPath =
                        path.join(
                            sessionPath,
                            "creds.json"
                        );

                    /*
                     * Make sure creds.json exists.
                     */
                    if (!fs.existsSync(credsPath)) {

                        throw new Error(
                            "creds.json was not created."
                        );
                    }

                    /*
                     |--------------------------------------------------------------------------
                     | READ RAW CREDS
                     |--------------------------------------------------------------------------
                     */

                    const rawCreds =
                        fs.readFileSync(
                            credsPath
                        );

                    console.log(
                        "📄 creds.json loaded."
                    );

                    /*
                     |--------------------------------------------------------------------------
                     | USER JID
                     |--------------------------------------------------------------------------
                     */

                    const userJid =
                        jidNormalizedUser(
                            `${number}@s.whatsapp.net`
                        );

                    /*
                     |--------------------------------------------------------------------------
                     | SEND RAW CREDS.JSON
                     |--------------------------------------------------------------------------
                     */

                    await socket.sendMessage(
                        userJid,
                        {
                            document: rawCreds,

                            mimetype:
                                "application/json",

                            fileName:
                                "creds.json"
                        }
                    );

                    console.log(
                        "📄 Raw creds.json sent."
                    );

                    /*
                     |--------------------------------------------------------------------------
                     | CREATE JINWOOBOT SESSION STRING
                     |--------------------------------------------------------------------------
                     |
                     | Format:
                     |
                     | JinwooBot!<base64-gzip-data>
                     |
                     */

                    const compressedCreds =
                        zlib.gzipSync(
                            rawCreds
                        );

                    const sessionString =
                        `JinwooBot!${compressedCreds.toString("base64")}`;

                    console.log(
                        "🔑 JinwooBot session string generated."
                    );

                    /*
                     |--------------------------------------------------------------------------
                     | SEND RAW SESSION STRING
                     |--------------------------------------------------------------------------
                     */

                    await socket.sendMessage(
                        userJid,
                        {
                            text:
                                sessionString
                        }
                    );

                    console.log(
                        "🔑 Raw JinwooBot session string sent."
                    );

                    /*
                     |--------------------------------------------------------------------------
                     | SEND WARNING / BRANDING
                     |--------------------------------------------------------------------------
                     */

                    await socket.sendMessage(
                        userJid,
                        {
                            text:
`⚠️ *DO NOT SHARE THIS SESSION WITH ANYONE* ⚠️

┌┤✑  *Thanks for using JinwooBot*
│└────────────┈ ⳹
│ ©2026 Chris-Tech ✌︎㋡
└─────────────────┈ ⳹`
                        }
                    );

                    console.log(
                        "⚠️ Warning message sent."
                    );

                    /*
                     * IMPORTANT:
                     *
                     * We do NOT delete the session immediately.
                     *
                     * This gives Baileys time to finish
                     * saving all authentication state.
                     */

                    await delay(3000);

                    console.log(
                        "✅ Pairing process completed."
                    );

                } catch (error) {

                    console.error(
                        "❌ Error sending session:",
                        error
                    );
                }

                return;
            }

            /*
             |--------------------------------------------------------------------------
             | CONNECTION CLOSED
             |--------------------------------------------------------------------------
             */

            if (connection === "close") {

                const statusCode =
                    lastDisconnect
                        ?.error
                        ?.output
                        ?.statusCode;

                console.log(
                    `❌ WhatsApp connection closed: ${statusCode || "unknown"}`
                );

                activeSessions.delete(
                    number
                );

                /*
                 * Only delete credentials when
                 * WhatsApp actually logged out.
                 */

                if (
                    statusCode ===
                    DisconnectReason.loggedOut
                ) {

                    console.log(
                        "🚪 WhatsApp logged out."
                    );

                    removeSession(
                        number
                    );

                    return;
                }

                console.log(
                    "ℹ️ Authentication files preserved."
                );
            }
        }
    );

    return socket;
}

/*
|--------------------------------------------------------------------------
| PAIRING CODE ENDPOINT
|--------------------------------------------------------------------------
*/

router.get(
    "/",
    async (req, res) => {

        let number =
            normalizeNumber(
                req.query.number
            );

        /*
         * Check number exists.
         */

        if (!number) {

            return res.status(400).json({
                success: false,

                error:
                    "WhatsApp number is required."
            });
        }

        /*
         * Validate number.
         */

        const phone =
            pn("+" + number);

        if (!phone.isValid()) {

            return res.status(400).json({
                success: false,

                error:
                    "Invalid international WhatsApp number."
            });
        }

        /*
         * Convert to E.164 without +.
         */

        number =
            phone
                .getNumber("e164")
                .replace("+", "");

        /*
         * Prevent duplicate pairing sessions.
         */

        if (
            activeSessions.has(number)
        ) {

            return res.status(409).json({
                success: false,

                error:
                    "A pairing session is already active for this number."
            });
        }

        /*
         * Remove unfinished previous session.
         */

        removeSession(number);

        try {

            console.log(
                `🔐 Starting JinwooBot pairing for ${number}`
            );

            /*
             * Create socket.
             */

            const socket =
                await createSocket(
                    number
                );

            activeSessions.set(
                number,
                socket
            );

            /*
             * Give WhatsApp socket time to initialize.
             */

            await delay(3000);

            /*
             * Already registered?
             */

            if (
                socket.authState
                    ?.creds
                    ?.registered
            ) {

                return res.json({
                    success: true,

                    registered: true,

                    message:
                        "This WhatsApp number is already linked."
                });
            }

            /*
             |--------------------------------------------------------------------------
             | REQUEST PAIRING CODE
             |--------------------------------------------------------------------------
             */

            console.log(
                `📱 Requesting pairing code for ${number}`
            );

            let code =
                await socket.requestPairingCode(
                    number
                );

            if (!code) {

                throw new Error(
                    "WhatsApp returned an empty pairing code."
                );
            }

            /*
             * Format:
             *
             * ABCD-EFGH
             */

            code =
                String(code)
                    .replace(
                        /\s+/g,
                        ""
                    )
                    .match(
                        /.{1,4}/g
                    )
                    ?.join("-") ||
                String(code);

            console.log(
                `🔑 Pair code: ${code}`
            );

            /*
             * Return code to frontend.
             */

            return res.json({

                success: true,

                registered: false,

                code,

                number,

                message:
                    "Enter this code in WhatsApp → Linked Devices → Link with phone number."
            });

        } catch (error) {

            console.error(
                "❌ Pairing error:",
                error
            );

            activeSessions.delete(
                number
            );

            /*
             * Clean failed pairing session.
             */

            removeSession(number);

            if (!res.headersSent) {

                return res.status(503).json({

                    success: false,

                    error:
                        "Unable to generate a WhatsApp pairing code.",

                    details:
                        process.env.NODE_ENV === "production"
                            ? undefined
                            : error.message
                });
            }
        }
    }
);

/*
|--------------------------------------------------------------------------
| SESSION STATUS
|--------------------------------------------------------------------------
*/

router.get(
    "/status",
    async (req, res) => {

        const number =
            normalizeNumber(
                req.query.number
            );

        if (!number) {

            return res.status(400).json({
                success: false,

                error:
                    "Number is required."
            });
        }

        const socket =
            activeSessions.get(
                number
            );

        if (!socket) {

            return res.json({

                success: true,

                connected: false,

                active: false
            });
        }

        return res.json({

            success: true,

            active: true,

            connected:
                Boolean(
                    socket.user
                ),

            registered:
                Boolean(
                    socket.authState
                        ?.creds
                        ?.registered
                )
        });
    }
);

export default router;