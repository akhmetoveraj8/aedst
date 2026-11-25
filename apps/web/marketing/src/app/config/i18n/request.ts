import { loadMessages } from "@/app/config/i18n/messages";
import { createRequestConfig } from "@/shared/i18n/request-config";

export default createRequestConfig((locale) => loadMessages(locale));
