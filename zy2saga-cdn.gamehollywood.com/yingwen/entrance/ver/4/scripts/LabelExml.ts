/**
 * 示例自定义插件，您可以查阅 http://developer.egret.com/cn/2d/projectConfig/cmdExtensionPluginin/
 * 了解如何开发一个自定义插件
 */
export class LabelExml implements plugins.Command {

	async onFile(file: plugins.File) {
		if (file.extname == ".exml") {
			let str = file.contents.toString();
			str = str.replace(/wordWrap=\"true\"/g, "");
			str = str.replace(/wordWrap=\"false\"/g, "");
			str = str.replace(/<e:Label/g, "<e:Label wordWrap=\"true\"");
			str = str.replace(/\"黑体\"/g, "\"Times\"");
			str = str.replace(/\"SimHei\"/g, "\"Times\"");
			file.contents = new Buffer(str);
		}
		return file;
	}

	async onFinish(commandContext: plugins.CommandContext) {
	}
}