/** 返回需要由 Composer 补充处理的非图片剪贴板文件。 */
export const getNonImageClipboardFiles = (files: FileList | readonly File[]) =>
  Array.from(files).filter((file) => !file.type.startsWith('image/'))
