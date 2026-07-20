package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"fio-go/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	application := app.NewApp()

	err := wails.Run(&options.App{
		Title:  "NetTopo 性能测试工具",
		Width:  1200,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 245, G: 245, B: 220, A: 1},
		OnStartup:        application.Startup,
		Bind: []interface{}{
			application,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
