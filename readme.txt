# 方式一：直接运行 (适用于开发测试)
## 假设你的终端目前在 fio-go 目录下
go run main.go -data ../fio/data -output-dir ./output

参数说明：
-data: 指定 fio JSON 数据所在的目录。
-output-dir: 指定生成的 HTML 和 Excel 报告的保存路径。

# 方式二：编译后运行 (适用于正式使用)
## 1. 编译生成名为 fio-go 的可执行文件
go build -o fio-go main.go

## 2. 运行生成的可执行文件
./fio-go -data ../fio/data -output-dir ./output