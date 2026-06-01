package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jung-kurt/gofpdf"
)

type HealthResponse struct {
	Service   string `json:"service"`
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
}

type Summary struct {
	HighRiskCases     int    `json:"high_risk_cases"`
	AverageConfidence string `json:"average_confidence"`
	PossibleOHTS      int    `json:"possible_ohts"`
	CriticalOHTS      int    `json:"critical_ohts"`
}

type HighRiskRow struct {
	Code          string `json:"code"`
	Patient      string `json:"patient"`
	AgeGender    string `json:"age_gender"`
	Eye           string `json:"eye"`
	Prediction    string `json:"prediction"`
	Confidence    string `json:"confidence"`
	OHTS          string `json:"ohts"`
	CDR           string `json:"cdr"`
	ScreeningDate string `json:"screening_date"`
	GradCam       string `json:"grad_cam"`
}

type HighRiskReportRequest struct {
	ClinicName    string        `json:"clinic_name"`
	ReportPeriod  string        `json:"report_period"`
	GeneratedDate string        `json:"generated_date"`
	GeneratedBy   string        `json:"generated_by"`
	Summary        Summary       `json:"summary"`
	Rows           []HighRiskRow `json:"rows"`
}

type ReportSummaryItem struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type ReportColumn struct {
	Key   string  `json:"key"`
	Label string  `json:"label"`
	Width float64 `json:"width"`
}

type TabularReportRequest struct {
	ReportCode    string              `json:"report_code"`
	Title         string              `json:"title"`
	Caption       string              `json:"caption"`
	ClinicName    string              `json:"clinic_name"`
	ReportPeriod  string              `json:"report_period"`
	GeneratedDate string              `json:"generated_date"`
	GeneratedBy   string              `json:"generated_by"`
	Summary       []ReportSummaryItem  `json:"summary"`
	Filters       []string            `json:"filters"`
	Columns       []ReportColumn      `json:"columns"`
	Rows          []map[string]string `json:"rows"`
	FooterNote    string              `json:"footer_note"`
	Orientation   string              `json:"orientation"`
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := HealthResponse{
		Service:   "glaucomaai-report-service",
		Status:    "ok",
		Timestamp: time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

func testPdfHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	pdf := gofpdf.New("L", "mm", "A4", "")
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 16)
	pdf.Cell(40, 10, "GlaucomaAI Go Report Service")
	pdf.Ln(12)

	pdf.SetFont("Arial", "", 11)
	pdf.Cell(40, 8, "Test PDF generated from Go microservice.")
	pdf.Ln(8)
	pdf.Cell(40, 8, "This confirms that Go can return PDF bytes to the browser.")

	writePdfResponse(w, pdf, "go_test_report.pdf")
}

func highRiskPdfHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request HighRiskReportRequest

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	tabularRequest := convertHighRiskToTabular(request)
	pdf := buildTabularReportPdf(tabularRequest)

	writePdfResponse(w, pdf, "high_risk_report_go.pdf")
}

func tabularReportPdfHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request TabularReportRequest

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(request.Title) == "" {
		http.Error(w, "Report title is required", http.StatusBadRequest)
		return
	}

	if len(request.Columns) == 0 {
		http.Error(w, "At least one report column is required", http.StatusBadRequest)
		return
	}

	pdf := buildTabularReportPdf(request)
	filename := safeFileName(request.ReportCode, "report") + "_go.pdf"

	writePdfResponse(w, pdf, filename)
}

func convertHighRiskToTabular(request HighRiskReportRequest) TabularReportRequest {
	rows := make([]map[string]string, 0, len(request.Rows))

	for _, row := range request.Rows {
		rows = append(rows, map[string]string{
			"code":           row.Code,
			"patient":        row.Patient,
			"age_gender":     row.AgeGender,
			"eye":            row.Eye,
			"prediction":     row.Prediction,
			"confidence":     row.Confidence,
			"ohts":           row.OHTS,
			"cdr":            row.CDR,
			"screening_date": row.ScreeningDate,
			"grad_cam":       row.GradCam,
		})
	}

	return TabularReportRequest{
		ReportCode:    "high_risk_report",
		Title:         "High Risk Report",
		Caption:       "Glaucoma-positive and clinically high-risk screening records",
		ClinicName:    request.ClinicName,
		ReportPeriod:  request.ReportPeriod,
		GeneratedDate: request.GeneratedDate,
		GeneratedBy:   request.GeneratedBy,
		Summary: []ReportSummaryItem{
			{Label: "High risk cases", Value: fmt.Sprintf("%d", request.Summary.HighRiskCases)},
			{Label: "Average confidence", Value: request.Summary.AverageConfidence},
			{Label: "Possible OHTS", Value: fmt.Sprintf("%d", request.Summary.PossibleOHTS)},
			{Label: "Critical OHTS", Value: fmt.Sprintf("%d", request.Summary.CriticalOHTS)},
		},
		Filters: []string{
			"Prediction: Glaucoma",
			"OHTS: Possible or Critical",
		},
		Columns: []ReportColumn{
			{Key: "code", Label: "Code", Width: 0.13},
			{Key: "patient", Label: "Patient", Width: 0.14},
			{Key: "age_gender", Label: "Age / Gender", Width: 0.11},
			{Key: "eye", Label: "Eye", Width: 0.08},
			{Key: "prediction", Label: "Prediction", Width: 0.10},
			{Key: "confidence", Label: "Confidence", Width: 0.09},
			{Key: "ohts", Label: "OHTS", Width: 0.09},
			{Key: "cdr", Label: "CDR", Width: 0.07},
			{Key: "screening_date", Label: "Screening Date", Width: 0.12},
			{Key: "grad_cam", Label: "Grad-CAM", Width: 0.07},
		},
		Rows: rows,
		FooterNote:  "Clinical note: This report supports glaucoma screening review only. It is not a standalone diagnostic decision.",
		Orientation: "L",
	}
}

func findLogoPath() string {
	possiblePaths := []string{
		filepath.Join("assets", "glaucoma-ai-logo-light.png"),
		filepath.Join("backend", "assets", "glaucoma-ai-logo-light.png"),
		filepath.Join("..", "backend", "assets", "glaucoma-ai-logo-light.png"),
		filepath.Join("..", "..", "backend", "assets", "glaucoma-ai-logo-light.png"),
		filepath.Join("..", "..", "assets", "glaucoma-ai-logo-light.png"),
	}

	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	return ""
}

func buildTabularReportPdf(request TabularReportRequest) *gofpdf.Fpdf {
	orientation := strings.ToUpper(strings.TrimSpace(request.Orientation))

	if orientation != "P" && orientation != "L" {
		orientation = "L"
	}

	pdf := gofpdf.New(orientation, "mm", "A4", "")
	pdf.SetMargins(8, 8, 8)
	pdf.SetAutoPageBreak(true, 12)

	pageWidth, _ := pdf.GetPageSize()
	leftMargin, _, rightMargin, _ := pdf.GetMargins()
	contentWidth := pageWidth - leftMargin - rightMargin

	footerNote := safeText(
		request.FooterNote,
		"Clinical note: This report supports review and screening follow-up only. It is not a standalone diagnostic decision.",
	)

	pdf.SetFooterFunc(func() {
		pdf.SetY(-10)
		pdf.SetFont("Arial", "", 8)

		pdf.CellFormat(
			contentWidth*0.75,
			6,
			footerNote,
			"",
			0,
			"L",
			false,
			0,
			"",
		)

		pdf.CellFormat(
			contentWidth*0.25,
			6,
			fmt.Sprintf("Page %d", pdf.PageNo()),
			"",
			0,
			"R",
			false,
			0,
			"",
		)
	})

	pdf.AddPage()
	drawReportHeader(pdf, request)

	tableStartY := drawSummaryAndFilters(pdf, request)
	drawGenericTable(pdf, contentWidth, request.Columns, request.Rows, tableStartY)

	return pdf
}

func drawReportHeader(pdf *gofpdf.Fpdf, request TabularReportRequest) {
	pageWidth, _ := pdf.GetPageSize()
	leftMargin, _, rightMargin, _ := pdf.GetMargins()

	logoPath := findLogoPath()

	if logoPath != "" {
		pdf.ImageOptions(
			logoPath,
			leftMargin,
			9,
			58,
			0,
			false,
			gofpdf.ImageOptions{
				ImageType: "PNG",
				ReadDpi:   true,
			},
			0,
			"",
		)
	} else {
		pdf.SetFont("Arial", "B", 22)
		pdf.SetXY(leftMargin, 10)
		pdf.Cell(70, 10, "GlaucomaAI")
	}

	pdf.SetFont("Arial", "", 10)
	pdf.SetXY(leftMargin, 24)
	pdf.Cell(80, 6, safeText(request.ClinicName, "Clinic Name"))

	rightBlockWidth := 115.0
	rightX := pageWidth - rightMargin - rightBlockWidth

	pdf.SetXY(rightX, 10)
	pdf.SetFont("Arial", "B", 11)
	pdf.CellFormat(rightBlockWidth, 5, safeText(request.Title, "Report"), "", 1, "R", false, 0, "")

	if strings.TrimSpace(request.ReportPeriod) != "" {
		pdf.SetX(rightX)
		pdf.SetFont("Arial", "", 10)
		pdf.CellFormat(rightBlockWidth, 5, "Report period: "+request.ReportPeriod, "", 1, "R", false, 0, "")
	}

	pdf.SetX(rightX)
	pdf.SetFont("Arial", "", 10)
	pdf.CellFormat(rightBlockWidth, 5, "Generated date: "+safeText(request.GeneratedDate, "N/A"), "", 1, "R", false, 0, "")

	pdf.SetX(rightX)
	pdf.CellFormat(rightBlockWidth, 5, "Generated by: "+safeText(request.GeneratedBy, "System User"), "", 1, "R", false, 0, "")

	if strings.TrimSpace(request.Caption) != "" {
		pdf.SetXY(leftMargin, 34)
		pdf.SetFont("Arial", "", 9)
		pdf.MultiCell(170, 5, request.Caption, "", "L", false)
	}
}

func drawSummaryAndFilters(pdf *gofpdf.Fpdf, request TabularReportRequest) float64 {
	leftMargin, _, _, _ := pdf.GetMargins()

	startY := 46.0
	rowHeight := 8.0

	pdf.SetXY(leftMargin, startY)

	summaryHeight := 0.0
	filterHeight := 0.0

	if len(request.Summary) > 0 {
		drawSummaryItems(pdf, request.Summary)
		summaryHeight = float64(len(request.Summary)) * rowHeight
	}

	if len(request.Filters) > 0 {
		pdf.SetXY(leftMargin+86, startY)
		drawFilterItems(pdf, request.Filters)
		filterHeight = rowHeight
	}

	contentHeight := summaryHeight

	if filterHeight > contentHeight {
		contentHeight = filterHeight
	}

	if contentHeight == 0 {
		contentHeight = rowHeight
	}

	return startY + contentHeight + 8
}

func drawSummaryItems(pdf *gofpdf.Fpdf, summary []ReportSummaryItem) {
	labelWidth := 45.0
	valueWidth := 25.0
	rowHeight := 8.0

	pdf.SetFont("Arial", "", 9)

	for _, item := range summary {
		x := pdf.GetX()
		y := pdf.GetY()

		pdf.SetFont("Arial", "B", 9)
		pdf.Rect(x, y, labelWidth, rowHeight, "")
		pdf.CellFormat(labelWidth, rowHeight, safeText(item.Label, "Metric"), "", 0, "L", false, 0, "")

		pdf.SetFont("Arial", "", 9)
		pdf.Rect(x+labelWidth, y, valueWidth, rowHeight, "")
		pdf.CellFormat(valueWidth, rowHeight, safeText(item.Value, "N/A"), "", 1, "L", false, 0, "")
	}
}

func drawFilterItems(pdf *gofpdf.Fpdf, filters []string) {
	labelWidth := 35.0
	valueWidth := 95.0
	rowHeight := 8.0

	pdf.SetFont("Arial", "B", 9)
	pdf.CellFormat(labelWidth, rowHeight, "Applied filters", "1", 0, "L", false, 0, "")

	pdf.SetFont("Arial", "", 9)
	pdf.CellFormat(valueWidth, rowHeight, safeText(strings.Join(filters, ", "), "None"), "1", 1, "L", false, 0, "")
}

func drawGenericTable(
	pdf *gofpdf.Fpdf,
	contentWidth float64,
	columns []ReportColumn,
	rows []map[string]string,
	startY float64,
) {
	leftMargin, topMargin, _, bottomMargin := pdf.GetMargins()
	_, pageHeight := pdf.GetPageSize()

	widths := calculateColumnWidths(contentWidth, columns)
	rowHeight := 8.0

	drawHeader := func() {
		pdf.SetLineWidth(0.2)
		pdf.SetFillColor(242, 242, 242)
		pdf.SetFont("Arial", "B", 8)

		for index, column := range columns {
			label := truncateForCell(pdf, safeText(column.Label, column.Key), widths[index]-2)
			pdf.CellFormat(widths[index], rowHeight, label, "1", 0, "L", true, 0, "")
		}

		pdf.Ln(rowHeight)
		pdf.SetFont("Arial", "", 8)
	}

	ensureSpaceForRow := func() {
		if pdf.GetY()+rowHeight > pageHeight-bottomMargin {
			pdf.AddPage()
			pdf.SetXY(leftMargin, topMargin)
			drawHeader()
		}
	}

	pdf.SetXY(leftMargin, startY)
	drawHeader()

	for rowIndex, row := range rows {
		ensureSpaceForRow()

		fill := rowIndex%2 == 1

		if fill {
			pdf.SetFillColor(248, 248, 248)
		} else {
			pdf.SetFillColor(255, 255, 255)
		}

		for index, column := range columns {
			value := safeText(row[column.Key], "N/A")
			value = truncateForCell(pdf, value, widths[index]-2)
			pdf.CellFormat(widths[index], rowHeight, value, "1", 0, "L", fill, 0, "")
		}

		pdf.Ln(rowHeight)
	}

	minimumRows := 8

	for index := len(rows); index < minimumRows; index++ {
		ensureSpaceForRow()

		for _, width := range widths {
			pdf.CellFormat(width, rowHeight, "", "1", 0, "L", false, 0, "")
		}

		pdf.Ln(rowHeight)
	}
}

func calculateColumnWidths(contentWidth float64, columns []ReportColumn) []float64 {
	widths := make([]float64, len(columns))
	totalRatio := 0.0

	for _, column := range columns {
		if column.Width > 0 {
			totalRatio += column.Width
		}
	}

	if totalRatio <= 0 {
		equalWidth := contentWidth / float64(len(columns))

		for index := range widths {
			widths[index] = equalWidth
		}

		return widths
	}

	for index, column := range columns {
		ratio := column.Width

		if ratio <= 0 {
			ratio = 1 / float64(len(columns))
		}

		widths[index] = contentWidth * (ratio / totalRatio)
	}

	return widths
}

func truncateForCell(pdf *gofpdf.Fpdf, value string, maxWidth float64) string {
	text := strings.TrimSpace(value)

	if text == "" {
		return ""
	}

	if pdf.GetStringWidth(text) <= maxWidth {
		return text
	}

	ellipsis := "..."

	for len(text) > 0 && pdf.GetStringWidth(text+ellipsis) > maxWidth {
		text = strings.TrimSpace(text[:len(text)-1])
	}

	if text == "" {
		return ellipsis
	}

	return text + ellipsis
}

func writePdfResponse(w http.ResponseWriter, pdf *gofpdf.Fpdf, filename string) {
	var buffer bytes.Buffer

	if err := pdf.Output(&buffer); err != nil {
		http.Error(w, "Failed to generate PDF", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(http.StatusOK)

	if _, err := w.Write(buffer.Bytes()); err != nil {
		log.Printf("Failed to write PDF response: %v", err)
	}
}

func safeText(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}

	return value
}

func safeFileName(value string, fallback string) string {
	text := strings.ToLower(strings.TrimSpace(value))

	if text == "" {
		text = fallback
	}

	replacer := strings.NewReplacer(
		" ", "_",
		"-", "_",
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)

	text = replacer.Replace(text)

	for strings.Contains(text, "__") {
		text = strings.ReplaceAll(text, "__", "_")
	}

	return strings.Trim(text, "_")
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/reports/test-pdf", testPdfHandler)
	mux.HandleFunc("/reports/high-risk/pdf", highRiskPdfHandler)
	mux.HandleFunc("/reports/tabular/pdf", tabularReportPdfHandler)

	server := &http.Server{
		Addr:         ":8081",
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 20 * time.Second,
	}

	log.Println("Go report service running on http://localhost:8081")
	log.Fatal(server.ListenAndServe())
}