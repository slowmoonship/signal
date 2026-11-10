/**
 * 站点部署在项目子路径下。
 *
 * GitHub Pages 的项目站点挂在 `https://<账号>.github.io/<仓库>/`，
 * 因此本项目的规范根是 `https://slowmoonship.github.io/signal/`。
 *
 * **这个常量必须与 `next.config.ts` 里的 `basePath` 一致**，
 * 所以两处都从这里取，而不是各写一份字面量：
 * 写错了不会编译报错，只会让 canonical 指向一个不存在的地址。
 *
 * 写死而不是走环境变量：部署目标是确定的，
 * 而一个"忘了配"的环境变量会让 CI 构建出一份路径全错的站点——
 * 那种错要等到线上点开链接才发现。
 */
export const BASE_PATH = '/signal'
