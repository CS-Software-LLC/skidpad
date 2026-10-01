import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import TireExplorer from "../../components/TireExplorer.vue";
import ValidationTable from "../../components/ValidationTable.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("TireExplorer", TireExplorer);
    app.component("ValidationTable", ValidationTable);
  },
} satisfies Theme;
