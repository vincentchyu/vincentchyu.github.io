/**
 * Unit & Integration Test for map-sources.js (TDD Refactor Verification)
 */

// 模拟浏览器 localStorage 与 window 环境
const store = {};
global.localStorage = {
  getItem: (k) => store[k] || null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

global.window = {
  location: { hostname: "vincentchyu.github.io" }, // 模拟生产静态环境
  localStorage: global.localStorage,
};

// 引入 map-sources.js
require("./map-sources.js");

const { CredentialStore, MapSourceRegistry } = global.window;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log("=== 开始测试 MapSourceRegistry 与 CredentialStore ===");

// 1. 测试内置 Providers 完整性
const providers = MapSourceRegistry.getAllProviders();
assert(providers.length >= 4, "应当至少包含 4 个核心 Provider (Thunderforest, OpenFreeMap, OpenTopoMap, Esri)");

const tf = MapSourceRegistry.getProvider("thunderforest");
assert(tf && tf.styles.length === 4, "Thunderforest 应当包含 4 个样式 (暗黑, 等高线, 骑行, 地貌)");

const ofm = MapSourceRegistry.getProvider("openfreemap");
assert(ofm && ofm.auth === null, "OpenFreeMap 应当为免 Token 源");

const otm = MapSourceRegistry.getProvider("opentopomap");
assert(otm && otm.auth === null, "OpenTopoMap 应当为免 Token 源");

const esri = MapSourceRegistry.getProvider("esri");
assert(esri && esri.auth === null, "Esri 应当为免 Token 源");

// 2. 测试 Style 检索
const darkStyle = MapSourceRegistry.getStyle("dark-topo");
assert(darkStyle && darkStyle.providerId === "thunderforest", "通过 alias 或 id 能正确获取 dark-topo");

const otmStyle = MapSourceRegistry.getStyle("opentopomap");
assert(otmStyle && otmStyle.providerId === "opentopomap", "能正确获取 opentopomap");

// 3. 测试免 Token 图源的 Auth 校验
assert(MapSourceRegistry.hasValidAuth(otmStyle) === true, "OpenTopoMap 应该判定为 auth 有效 (无需 Token)");
assert(MapSourceRegistry.hasValidAuth(ofm.styles[0]) === true, "OpenFreeMap 应该判定为 auth 有效 (无需 Token)");
assert(MapSourceRegistry.hasValidAuth(esri.styles[0]) === true, "Esri 应该判定为 auth 有效 (无需 Token)");

// 4. 测试 Thunderforest 在静态环境无 Token 时的状态
CredentialStore.remove(CredentialStore.KEYS.THUNDERFOREST);
assert(MapSourceRegistry.hasValidAuth(darkStyle) === false, "静态环境下无 Token 时 Thunderforest 应当判定为需要鉴权");

// 5. 测试 CredentialStore 设置 Token
CredentialStore.set(CredentialStore.KEYS.THUNDERFOREST, "test_token_12345");
assert(CredentialStore.get(CredentialStore.KEYS.THUNDERFOREST) === "test_token_12345", "Token 成功写入 localStorage");
assert(MapSourceRegistry.hasValidAuth(darkStyle) === true, "写入 Token 后 Thunderforest 应当判定为 auth 有效");

// 6. 测试 URL 解析与 Token 注入
const resolvedTiles = MapSourceRegistry.resolveTiles(darkStyle);
assert(resolvedTiles.length > 0 && resolvedTiles[0].includes("apikey=test_token_12345"), "URL 成功将 {apikey} 替换为真实 Token");

// 7. 测试自定义 XYZ 源扩展 (预留机制)
CredentialStore.saveCustomSource({
  id: "my_custom_tile",
  name: "我的等高线",
  url: "https://tile.example.com/{z}/{x}/{y}.png",
});

const customStyle = MapSourceRegistry.getStyle("my_custom_tile");
assert(customStyle && customStyle.name === "我的等高线", "能够动态检索到自定义 XYZ 源");
assert(customStyle.tiles[0] === "https://tile.example.com/{z}/{x}/{y}.png", "自定义源切片 URL 正确");

CredentialStore.removeCustomSource("my_custom_tile");
assert(MapSourceRegistry.getStyle("my_custom_tile") === null, "自定义源删除成功");

// 8. 测试图层 Overlay 显隐配置保存
CredentialStore.saveOverlayConfig({ tracks: true, photos: false, waypoints: true });
const loadedConfig = CredentialStore.getOverlayConfig();
assert(loadedConfig.photos === false && loadedConfig.tracks === true, "Overlay 显隐配置持久化正确");

console.log("\n🎉 所有测试均已成功通过！");
