import * as mega from "megajs";
import dotenv from "dotenv";

dotenv.config();

const auth = {
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD,
    userAgent:
        process.env.MEGA_USER_AGENT ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/42.0.2311.135 Safari/537.36"
};

// Validate credentials
if (!auth.email || !auth.password) {
    throw new Error(
        "Missing MEGA_EMAIL or MEGA_PASSWORD in .env"
    );
}


/**
 * Upload a file to Mega and return its public URL
 */
export const upload = (data, name) => {
    return new Promise((resolve, reject) => {
        try {
            const storage = new mega.Storage(auth, () => {

                const uploadStream = storage.upload({
                    name,
                    allowUploadBuffering: true
                });

                data.pipe(uploadStream);

                storage.on("add", (file) => {

                    file.link((err, url) => {

                        if (err) {
                            storage.close();
                            reject(err);
                            return;
                        }

                        storage.close();

                        resolve(url);
                    });

                });

                storage.on("error", (error) => {
                    storage.close();
                    reject(error);
                });

            });

        } catch (err) {
            reject(err);
        }
    });
};


/**
 * Download a file from Mega using its URL
 */
export const download = (url) => {
    return new Promise((resolve, reject) => {

        try {

            const file = mega.File.fromURL(url);

            file.loadAttributes((err) => {

                if (err) {
                    reject(err);
                    return;
                }

                file.downloadBuffer((err, buffer) => {

                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(buffer);

                });

            });

        } catch (err) {
            reject(err);
        }

    });
};