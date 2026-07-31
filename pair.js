import express from "express";
import fs from "fs";
import path from "path";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import pn from "awesome-phonenumber";

const router = express.Router();

const logger = pino({
    level: "info"
});

const sessionsDir = path.resolve("./sessions");

if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, {
        recursive: true
    });
}

function removeSession(dir) {
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, {
                recursive: true,
                force: true
            });

            console.log("🧹 Session removed:", dir);
        }
    } catch (error) {
        console.error(
            "❌ Failed to remove session:",
            error
        );
    }
}

router.get("/", async (req, res) => {

    let number = String(
        req.query.number || ""
    );

    number = number.replace(
        /[^0-9]/g,
        ""
    );

    if (!number) {
        return res.status(400).json({
            error: "Phone number is required"
        });
    }

    const phone = pn(
        "+" + number
    );

    if (!phone.isValid()) {
        return res.status(400).json({
            error:
                "Invalid international WhatsApp number"
        });
    }

    number = phone
        .getNumber("e164")
        .replace("+", "");

    const sessionPath = path.join(
        sessionsDir,
        number
    );

    // Remove old unfinished session
    removeSession(sessionPath);

    let socket;

    try {

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(
            sessionPath
        );

        const {
            version
        } = await fetchLatestBaileysVersion();

        console.log(
            "📦 Baileys version:",
            version
        );

        socket = makeWASocket({

            version,

            auth: {
                creds: state.creds,

                keys:
                    makeCacheableSignalKeyStore(
                        state.keys,
                        logger
                    )
            },

            logger,

            printQRInTerminal: false,

            browser:
                Browsers.ubuntu(
                    "Chrome"
                ),

            markOnlineOnConnect: false,

            syncFullHistory: false,

            generateHighQualityLinkPreview: false,

            connectTimeoutMs: 60_000,

            defaultQueryTimeoutMs: 60_000,

            keepAliveIntervalMs: 20_000

        });

        socket.ev.on(
            "creds.update",
            saveCreds
        );

        socket.ev.on(
            "connection.update",
            async (update) => {

                const {
                    connection,
                    lastDisconnect
                } = update;

                console.log(
                    "🔌 Connection:",
                    connection
                );

                if (
                    connection === "open"
                ) {

                    console.log(
                        "✅ WhatsApp linked successfully!"
                    );

                    /*
                     * IMPORTANT:
                     * Do NOT immediately delete
                     * the authentication state.
                     *
                     * Keep it alive long enough
                     * for the session to finish.
                     */

                    try {

                        const jid =
                            number +
                            "@s.whatsapp.net";

                        await socket.sendMessage(
                            jid,
                            {
                                text:
                                    `╭━━━〔 JINWOO BOT 〕━━━╮

⚡ *JINWOO MINI-BOT*

✅ WhatsApp device linked successfully.

Your Jinwoo Bot session is now active.

⚠️ *SECURITY WARNING*
Never share your session credentials
with anyone.

╰━━━━━━━━━━━━━━━━━━╯`
                            }
                        );

                        console.log(
                            "📨 Jinwoo confirmation sent"
                        );

                    } catch (error) {

                        console.error(
                            "❌ Message error:",
                            error
                        );

                    }

                }


                if (
                    connection === "close"
                ) {

                    const statusCode =
                        lastDisconnect
                            ?.error
                            ?.output
                            ?.statusCode;

                    console.log(
                        "❌ Connection closed:",
                        statusCode
                    );

                    if (
                        statusCode ===
                        DisconnectReason.loggedOut
                    ) {

                        console.log(
                            "🚪 WhatsApp logged out"
                        );

                        removeSession(
                            sessionPath
                        );

                    } else {

                        console.log(
                            "🔄 Connection closed; session may reconnect."
                        );

                    }

                }

            }
        );


        /*
         * Generate pairing code
         */

        if (
            !socket.authState?.creds
                ?.registered
        ) {

            console.log(
                "⏳ Waiting for WhatsApp socket..."
            );

            await delay(3000);

            console.log(
                "🔐 Requesting pairing code for:",
                number
            );

            let code =
                await socket.requestPairingCode(
                    number
                );

            if (!code) {

                throw new Error(
                    "WhatsApp did not return a pairing code"
                );

            }

            code =
                String(code)
                    .match(/.{1,4}/g)
                    ?.join("-") ||
                code;

            console.log(
                "🔑 Pairing code:",
                code
            );

            if (!res.headersSent) {

                return res.json({
                    success: true,
                    code
                });

            }

        } else {

            return res.json({
                success: true,
                message:
                    "Session is already registered"
            });

        }

    } catch (error) {

        console.error(
            "❌ Pairing error:",
            error
        );

        if (!res.headersSent) {

            return res.status(503).json({
                success: false,
                error:
                    "Failed to generate pairing code"
            });

        }

    }

});

export default router;