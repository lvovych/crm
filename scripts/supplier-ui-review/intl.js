import { createTranslator } from "next-intl";
import suppliers from "../../messages/uk/suppliers.json";
const getTranslations = async (namespace) => createTranslator({ locale: "uk", messages: { suppliers }, namespace });
export {
  getTranslations
};
