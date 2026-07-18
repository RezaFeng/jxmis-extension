import { createAnalyticsCollector } from "../page/business-analytics/collector.js";
import { createJxpmoAnalyticsData } from "../page/business-analytics/jxpmo-data.js";
import { installBusinessAnalyticsPage } from "../page/business-analytics/install.js";

const windowRef = globalThis.window;
const data = createJxpmoAnalyticsData({
  fetch: windowRef.fetch.bind(windowRef),
  location: windowRef.location,
  storage: windowRef.localStorage,
  URLSearchParams: windowRef.URLSearchParams
});
const collector = createAnalyticsCollector({ data, AbortController: windowRef.AbortController });
installBusinessAnalyticsPage({ window: windowRef, collector });
