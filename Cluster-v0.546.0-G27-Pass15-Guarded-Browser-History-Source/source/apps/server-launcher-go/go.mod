module	cluster.local/server-launcher

go 1.27.1

require (
	cluster.local/native-alerts v0.0.0
	cluster.local/native-process-job v0.0.0
)

replace	cluster.local/native-alerts => ../native-alerts-go

replace	cluster.local/native-process-job => ../native-process-job-go
