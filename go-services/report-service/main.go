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
	Patient       string `json:"patient"`
	AgeGender     string `json:"age_gender"`
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
	Summary       Summary       `json:"summary"`
	Rows          []HighRiskRow `json:"rows"`
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
	Summary       []ReportSummaryItem `json:"summary"`
	Filters       []string            `json:"filters"`
	Columns       []ReportColumn      `json:"columns"`
	Rows          []map[string]string `json:"rows"`
	FooterNote    string              `json:"footer_note"`
	Orientation   string              `json:"orientation"`
}

type PatientClinicalInfo struct {
	PatientID   string `json:"patient_id"`
	PatientName string `json:"patient_name"`
	DOB         string `json:"dob"`
	Age         string `json:"age"`
	Gender      string `json:"gender"`
	Contact     string `json:"contact"`
	Email       string `json:"email"`
	IOP         string `json:"iop"`
	CCT         string `json:"cct"`
	Status      string `json:"status"`
}

type PatientClinicalChartPoint struct {
	DateTime   string  `json:"date_time"`
	AxisLabel  string  `json:"axis_label"`
	Eye        string  `json:"eye"`
	Result     string  `json:"result"`
	Confidence float64 `json:"confidence"`
}

type PatientClinicalHistoryRow struct {
	ScreeningDate string `json:"screening_date"`
	Eye           string `json:"eye"`
	Result        string `json:"result"`
	Confidence    string `json:"confidence"`
	OHTS          string `json:"ohts"`
	CDR           string `json:"cdr"`
	Clinician     string `json:"clinician"`
}

type PatientClinicalReportRequest struct {
	ReportCode    string                      `json:"report_code"`
	Title         string                      `json:"title"`
	Caption       string                      `json:"caption"`
	ClinicName    string                      `json:"clinic_name"`
	GeneratedDate string                      `json:"generated_date"`
	GeneratedBy   string                      `json:"generated_by"`
	Patient       PatientClinicalInfo         `json:"patient"`
	Summary       []ReportSummaryItem         `json:"summary"`
	ChartPoints   []PatientClinicalChartPoint `json:"chart_points"`
	HistoryRows   []PatientClinicalHistoryRow `json:"history_rows"`
	FooterNote    string                      `json:"footer_note"`
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

func patientClinicalPdfHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request PatientClinicalReportRequest

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(request.Title) == "" {
		request.Title = "Patient Clinical Summary Report"
	}

	if strings.TrimSpace(request.ReportCode) == "" {
		request.ReportCode = "patient_clinical_summary"
	}

	pdf := buildPatientClinicalReportPdf(request)
	filename := safeFileName(request.ReportCode, "patient_clinical_summary") + "_go.pdf"

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
		Rows:        rows,
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
	headerHeight := 8.0
	minRowHeight := 8.0
	lineHeight := 4.2
	cellPaddingX := 1.2
	cellPaddingY := 1.5

	drawHeader := func() {
		pdf.SetLineWidth(0.2)
		pdf.SetFillColor(242, 242, 242)
		pdf.SetFont("Arial", "B", 8)

		for index, column := range columns {
			label := truncateForCell(pdf, safeText(column.Label, column.Key), widths[index]-2)
			pdf.CellFormat(widths[index], headerHeight, label, "1", 0, "L", true, 0, "")
		}

		pdf.Ln(headerHeight)
		pdf.SetFont("Arial", "", 8)
	}

	ensureSpaceForRow := func(rowHeight float64) {
		if pdf.GetY()+rowHeight > pageHeight-bottomMargin {
			pdf.AddPage()
			pdf.SetXY(leftMargin, topMargin)
			drawHeader()
		}
	}

	drawWrappedRow := func(values []string, fill bool) {
		cellLines := make([][]string, len(values))
		maxLines := 1

		for index, value := range values {
			lines := splitTextForCell(pdf, safeText(value, "N/A"), widths[index]-(cellPaddingX*2))
			cellLines[index] = lines

			if len(lines) > maxLines {
				maxLines = len(lines)
			}
		}

		rowHeight := float64(maxLines)*lineHeight + (cellPaddingY * 2)

		if rowHeight < minRowHeight {
			rowHeight = minRowHeight
		}

		ensureSpaceForRow(rowHeight)

		if fill {
			pdf.SetFillColor(248, 248, 248)
		} else {
			pdf.SetFillColor(255, 255, 255)
		}

		startX := pdf.GetX()
		startY := pdf.GetY()
		currentX := startX

		for index, lines := range cellLines {
			cellWidth := widths[index]
			pdf.Rect(currentX, startY, cellWidth, rowHeight, "FD")

			pdf.SetXY(currentX+cellPaddingX, startY+cellPaddingY)

			for _, line := range lines {
				pdf.CellFormat(cellWidth-(cellPaddingX*2), lineHeight, line, "", 2, "L", false, 0, "")
			}

			currentX += cellWidth
			pdf.SetXY(currentX, startY)
		}

		pdf.SetXY(startX, startY+rowHeight)
	}

	pdf.SetXY(leftMargin, startY)
	drawHeader()

	for rowIndex, row := range rows {
		values := make([]string, 0, len(columns))

		for _, column := range columns {
			values = append(values, safeText(row[column.Key], "N/A"))
		}

		drawWrappedRow(values, rowIndex%2 == 1)
	}

	minimumRows := 8

	for index := len(rows); index < minimumRows; index++ {
		ensureSpaceForRow(minRowHeight)

		for _, width := range widths {
			pdf.CellFormat(width, minRowHeight, "", "1", 0, "L", false, 0, "")
		}

		pdf.Ln(minRowHeight)
	}
}

func splitTextForCell(pdf *gofpdf.Fpdf, value string, maxWidth float64) []string {
	text := strings.TrimSpace(value)

	if text == "" {
		return []string{""}
	}

	if maxWidth <= 0 {
		return []string{text}
	}

	lineBytes := pdf.SplitLines([]byte(text), maxWidth)
	lines := make([]string, 0, len(lineBytes))

	for _, line := range lineBytes {
		lineText := strings.TrimSpace(string(line))

		if lineText != "" {
			lines = append(lines, lineText)
		}
	}

	if len(lines) == 0 {
		return []string{text}
	}

	return lines
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

func buildPatientClinicalReportPdf(request PatientClinicalReportRequest) *gofpdf.Fpdf {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(10, 10, 10)
	pdf.SetAutoPageBreak(true, 14)

	pageWidth, _ := pdf.GetPageSize()
	leftMargin, _, rightMargin, _ := pdf.GetMargins()
	contentWidth := pageWidth - leftMargin - rightMargin

	footerNote := safeText(
		request.FooterNote,
		"Clinical note: This report supports glaucoma screening review only. It is not a standalone diagnostic decision.",
	)

	pdf.SetFooterFunc(func() {
		pdf.SetY(-10)
		pdf.SetFont("Arial", "", 8)
		pdf.CellFormat(contentWidth*0.78, 6, footerNote, "", 0, "L", false, 0, "")
		pdf.CellFormat(contentWidth*0.22, 6, fmt.Sprintf("Page %d", pdf.PageNo()), "", 0, "R", false, 0, "")
	})

	pdf.AddPage()

	drawPatientClinicalHeader(pdf, request)
	y := 44.0
	y = drawPatientClinicalDetails(pdf, request.Patient, y)
	y = drawPatientClinicalSummary(pdf, request.Summary, y+4)
	y = drawPatientClinicalChart(pdf, request.ChartPoints, y+5)
	drawPatientClinicalHistory(pdf, request.HistoryRows, y+6)

	return pdf
}

func drawPatientClinicalHeader(pdf *gofpdf.Fpdf, request PatientClinicalReportRequest) {
	pageWidth, _ := pdf.GetPageSize()
	leftMargin, _, rightMargin, _ := pdf.GetMargins()

	logoPath := findLogoPath()

	if logoPath != "" {
		pdf.ImageOptions(
			logoPath,
			leftMargin,
			9,
			48,
			0,
			false,
			gofpdf.ImageOptions{ImageType: "PNG", ReadDpi: true},
			0,
			"",
		)
	} else {
		pdf.SetFont("Arial", "B", 20)
		pdf.SetXY(leftMargin, 10)
		pdf.Cell(70, 10, "GlaucomaAI")
	}

	pdf.SetFont("Arial", "", 9)
	pdf.SetXY(leftMargin, 23)
	pdf.Cell(80, 5, safeText(request.ClinicName, "Clinic Name"))

	rightBlockWidth := 105.0
	rightX := pageWidth - rightMargin - rightBlockWidth

	pdf.SetXY(rightX, 10)
	pdf.SetFont("Arial", "B", 11)
	pdf.CellFormat(rightBlockWidth, 5, safeText(request.Title, "Patient Clinical Summary Report"), "", 1, "R", false, 0, "")

	pdf.SetX(rightX)
	pdf.SetFont("Arial", "", 9)
	pdf.CellFormat(rightBlockWidth, 5, "Generated date: "+safeText(request.GeneratedDate, "N/A"), "", 1, "R", false, 0, "")

	pdf.SetX(rightX)
	pdf.CellFormat(rightBlockWidth, 5, "Generated by: "+safeText(request.GeneratedBy, "System User"), "", 1, "R", false, 0, "")

	if strings.TrimSpace(request.Caption) != "" {
		pdf.SetXY(leftMargin, 31)
		pdf.SetFont("Arial", "", 8)
		pdf.MultiCell(180, 4, request.Caption, "", "L", false)
	}
}

func drawPatientClinicalDetails(pdf *gofpdf.Fpdf, patient PatientClinicalInfo, startY float64) float64 {
	leftMargin, _, _, _ := pdf.GetMargins()
	pageWidth, _ := pdf.GetPageSize()
	_, _, rightMargin, _ := pdf.GetMargins()
	contentWidth := pageWidth - leftMargin - rightMargin

	pdf.SetXY(leftMargin, startY)
	pdf.SetFont("Arial", "B", 10)
	pdf.CellFormat(contentWidth, 6, "Patient Details", "", 1, "L", false, 0, "")

	labels := []string{
		"Patient ID", "Name", "DOB / Age", "Gender",
		"Status", "Contact", "Email", "IOP / CCT",
	}
	values := []string{
		safeText(patient.PatientID, "N/A"),
		safeText(patient.PatientName, "N/A"),
		fmt.Sprintf("%s / %s", safeText(patient.DOB, "N/A"), safeText(patient.Age, "N/A")),
		safeText(patient.Gender, "N/A"),
		safeText(patient.Status, "N/A"),
		safeText(patient.Contact, "N/A"),
		safeText(patient.Email, "N/A"),
		fmt.Sprintf("%s / %s", safeText(patient.IOP, "N/A"), safeText(patient.CCT, "N/A")),
	}

	cellWidth := contentWidth / 2
	rowHeight := 8.5
	labelWidth := 27.0
	valueWidth := cellWidth - labelWidth

	pdf.SetFont("Arial", "", 8)
	pdf.SetDrawColor(190, 190, 190)

	for index := 0; index < len(labels); index += 2 {
		rowY := pdf.GetY()

		for col := 0; col < 2; col++ {
			itemIndex := index + col
			if itemIndex >= len(labels) {
				break
			}

			x := leftMargin + float64(col)*cellWidth
			pdf.SetXY(x, rowY)
			pdf.SetFillColor(245, 247, 250)
			pdf.SetFont("Arial", "B", 8)
			pdf.CellFormat(labelWidth, rowHeight, labels[itemIndex], "1", 0, "L", true, 0, "")

			pdf.SetFont("Arial", "", 8)
			pdf.SetFillColor(255, 255, 255)
			pdf.CellFormat(valueWidth, rowHeight, safeText(values[itemIndex], "N/A"), "1", 0, "L", true, 0, "")
		}

		pdf.SetY(rowY + rowHeight)
	}

	return pdf.GetY()
}

func drawPatientClinicalSummary(pdf *gofpdf.Fpdf, summary []ReportSummaryItem, startY float64) float64 {
	leftMargin, _, _, _ := pdf.GetMargins()
	pageWidth, _ := pdf.GetPageSize()
	_, _, rightMargin, _ := pdf.GetMargins()
	contentWidth := pageWidth - leftMargin - rightMargin

	pdf.SetXY(leftMargin, startY)
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(0, 0, 0)
	pdf.CellFormat(contentWidth, 6, "Screening Summary", "", 1, "L", false, 0, "")

	if len(summary) == 0 {
		pdf.SetFont("Arial", "", 8)
		pdf.CellFormat(contentWidth, 7, "No screening summary available.", "1", 1, "L", false, 0, "")
		return pdf.GetY()
	}

	// Fixed grid layout.
	// This prevents the summary cards from becoming staggered when drawing multiple cells.
	itemsPerRow := 3
	cardGapX := 4.0
	cardGapY := 4.0
	cardWidth := (contentWidth - (cardGapX * float64(itemsPerRow-1))) / float64(itemsPerRow)
	cardHeight := 14.0
	gridTop := startY + 10.0

	for index, item := range summary {
		row := index / itemsPerRow
		col := index % itemsPerRow

		x := leftMargin + float64(col)*(cardWidth+cardGapX)
		y := gridTop + float64(row)*(cardHeight+cardGapY)

		pdf.SetDrawColor(205, 211, 218)
		pdf.SetFillColor(245, 247, 250)
		pdf.Rect(x, y, cardWidth, cardHeight, "FD")

		pdf.SetXY(x+3, y+2.2)
		pdf.SetFont("Arial", "B", 7)
		pdf.SetTextColor(40, 48, 60)
		pdf.CellFormat(cardWidth-6, 3.5, safeText(item.Label, "Metric"), "", 1, "L", false, 0, "")

		pdf.SetXY(x+3, y+7.2)
		pdf.SetFont("Arial", "B", 10)
		pdf.SetTextColor(0, 0, 0)
		pdf.CellFormat(cardWidth-6, 5, safeText(item.Value, "N/A"), "", 1, "L", false, 0, "")
	}

	rows := (len(summary) + itemsPerRow - 1) / itemsPerRow
	gridBottom := gridTop + float64(rows)*cardHeight + float64(rows-1)*cardGapY

	pdf.SetY(gridBottom)
	return gridBottom
}

func drawPatientClinicalChart(pdf *gofpdf.Fpdf, points []PatientClinicalChartPoint, startY float64) float64 {
	leftMargin, _, _, _ := pdf.GetMargins()
	pageWidth, pageHeight := pdf.GetPageSize()
	_, _, rightMargin, bottomMargin := pdf.GetMargins()
	contentWidth := pageWidth - leftMargin - rightMargin

	chartHeight := 68.0
	if startY+chartHeight+14 > pageHeight-bottomMargin {
		pdf.AddPage()
		startY = 18
	}

	pdf.SetXY(leftMargin, startY)
	pdf.SetFont("Arial", "B", 10)
	pdf.CellFormat(contentWidth, 6, "Longitudinal Risk Tracking", "", 1, "L", false, 0, "")

	boxY := startY + 8
	pdf.SetDrawColor(205, 213, 224)
	pdf.SetFillColor(250, 252, 255)
	pdf.Rect(leftMargin, boxY, contentWidth, chartHeight, "FD")

	if len(points) == 0 {
		pdf.SetXY(leftMargin, boxY+28)
		pdf.SetFont("Arial", "", 9)
		pdf.CellFormat(contentWidth, 6, "No completed screening scores available for longitudinal tracking.", "", 0, "C", false, 0, "")
		return boxY + chartHeight
	}

	plotX := leftMargin + 22
	plotY := boxY + 9
	plotW := contentWidth - 34
	plotH := chartHeight - 25

	yForRisk := func(percent float64) float64 {
		if percent < 0 {
			percent = 0
		}
		if percent > 100 {
			percent = 100
		}
		return plotY + plotH - (percent/100.0)*plotH
	}

	xForIndex := func(index int) float64 {
		if len(points) == 1 {
			return plotX + plotW/2
		}
		return plotX + (float64(index)/float64(len(points)-1))*plotW
	}

	pdf.SetFont("Arial", "", 7)
	pdf.SetDrawColor(230, 230, 230)
	pdf.SetTextColor(90, 100, 115)

	for _, value := range []float64{0, 20, 40, 60, 80, 100} {
		y := yForRisk(value)
		pdf.Line(plotX, y, plotX+plotW, y)
		pdf.SetXY(plotX-14, y-2)
		pdf.CellFormat(12, 4, fmt.Sprintf("%.0f%%", value), "", 0, "R", false, 0, "")
	}

	refY := yForRisk(50)
	pdf.SetDrawColor(170, 105, 35)
	pdf.SetLineWidth(0.25)
	pdf.SetDashPattern([]float64{2, 2}, 0)
	pdf.Line(plotX, refY, plotX+plotW, refY)
	pdf.SetDashPattern([]float64{}, 0)
	pdf.SetXY(plotX+plotW-30, refY-5)
	pdf.SetTextColor(170, 105, 35)
	pdf.CellFormat(30, 4, "50% reference", "", 0, "R", false, 0, "")

	previousByEye := map[string]struct{ x, y float64 }{}

	for index, point := range points {
		x := xForIndex(index)
		y := yForRisk(point.Confidence)
		eyeKey := strings.ToLower(strings.TrimSpace(point.Eye))

		if previous, ok := previousByEye[eyeKey]; ok && eyeKey != "" {
			if eyeKey == "left" {
				pdf.SetDrawColor(35, 115, 78)
				pdf.SetDashPattern([]float64{2, 1.6}, 0)
			} else {
				pdf.SetDrawColor(30, 125, 135)
				pdf.SetDashPattern([]float64{}, 0)
			}

			pdf.SetLineWidth(0.7)
			pdf.Line(previous.x, previous.y, x, y)
			pdf.SetDashPattern([]float64{}, 0)
		}

		previousByEye[eyeKey] = struct{ x, y float64 }{x: x, y: y}
	}

	for index, point := range points {
		x := xForIndex(index)
		y := yForRisk(point.Confidence)
		result := strings.ToLower(strings.TrimSpace(point.Result))

		if result == "glaucoma" || result == "positive" {
			pdf.SetFillColor(170, 45, 50)
		} else {
			pdf.SetFillColor(35, 115, 78)
		}

		pdf.SetDrawColor(255, 255, 255)
		pdf.Circle(x, y, 2.2, "FD")
		pdf.SetTextColor(90, 100, 115)
		pdf.SetFont("Arial", "", 7)
		pdf.SetXY(x-3, y-7)
		pdf.CellFormat(6, 3.5, strings.ToUpper(safeText(string([]rune(safeText(point.Eye, " "))[0]), "")), "", 0, "C", false, 0, "")

		if len(points) <= 4 || index == 0 || index == len(points)-1 {
			pdf.SetXY(x-14, plotY+plotH+3)
			pdf.CellFormat(28, 4, safeText(point.AxisLabel, ""), "", 0, "C", false, 0, "")
		}
	}

	legendY := boxY + chartHeight - 7
	pdf.SetTextColor(90, 100, 115)
	pdf.SetFont("Arial", "", 7)
	pdf.SetDrawColor(30, 125, 135)
	pdf.Line(leftMargin+4, legendY, leftMargin+12, legendY)
	pdf.SetXY(leftMargin+14, legendY-2)
	pdf.Cell(28, 4, "Right eye trend")
	pdf.SetDrawColor(35, 115, 78)
	pdf.SetDashPattern([]float64{2, 1.6}, 0)
	pdf.Line(leftMargin+47, legendY, leftMargin+55, legendY)
	pdf.SetDashPattern([]float64{}, 0)
	pdf.SetXY(leftMargin+57, legendY-2)
	pdf.Cell(26, 4, "Left eye trend")

	pdf.SetTextColor(0, 0, 0)
	return boxY + chartHeight
}

func drawPatientClinicalHistory(pdf *gofpdf.Fpdf, rows []PatientClinicalHistoryRow, startY float64) float64 {
	leftMargin, _, _, bottomMargin := pdf.GetMargins()
	pageWidth, pageHeight := pdf.GetPageSize()
	_, _, rightMargin, _ := pdf.GetMargins()
	contentWidth := pageWidth - leftMargin - rightMargin

	if startY+24 > pageHeight-bottomMargin {
		pdf.AddPage()
		startY = 18
	}

	pdf.SetXY(leftMargin, startY)
	pdf.SetFont("Arial", "B", 10)
	pdf.CellFormat(contentWidth, 6, "Screening History", "", 1, "L", false, 0, "")

	columns := []string{"Date / Time", "Eye", "Result", "Confidence", "OHTS", "CDR", "Clinician"}
	widths := []float64{
		contentWidth * 0.16,
		contentWidth * 0.08,
		contentWidth * 0.20,
		contentWidth * 0.12,
		contentWidth * 0.13,
		contentWidth * 0.09,
		contentWidth * 0.22,
	}

	drawHeader := func() {
		pdf.SetFillColor(242, 242, 242)
		pdf.SetDrawColor(190, 190, 190)
		pdf.SetFont("Arial", "B", 7)
		for index, label := range columns {
			pdf.CellFormat(widths[index], 7, label, "1", 0, "L", true, 0, "")
		}
		pdf.Ln(7)
	}

	drawHeader()
	pdf.SetFont("Arial", "", 7)

	if len(rows) == 0 {
		pdf.CellFormat(contentWidth, 8, "No completed screening history found.", "1", 1, "C", false, 0, "")
		return pdf.GetY()
	}

	for index, row := range rows {
		if pdf.GetY()+8 > pageHeight-bottomMargin {
			pdf.AddPage()
			pdf.SetXY(leftMargin, 18)
			drawHeader()
			pdf.SetFont("Arial", "", 7)
		}

		if index%2 == 1 {
			pdf.SetFillColor(248, 248, 248)
		} else {
			pdf.SetFillColor(255, 255, 255)
		}

		values := []string{
			row.ScreeningDate,
			row.Eye,
			row.Result,
			row.Confidence,
			row.OHTS,
			row.CDR,
			row.Clinician,
		}

		for colIndex, value := range values {
			pdf.CellFormat(widths[colIndex], 8, truncateForCell(pdf, safeText(value, "N/A"), widths[colIndex]-2), "1", 0, "L", true, 0, "")
		}
		pdf.Ln(8)
	}

	return pdf.GetY()
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

func requiredEnv(key string) string {
	value := strings.TrimSpace(os.Getenv(key))

	if value == "" {
		log.Fatalf("%s is not configured", key)
	}

	return value
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/reports/test-pdf", testPdfHandler)
	mux.HandleFunc("/reports/high-risk/pdf", highRiskPdfHandler)
	mux.HandleFunc("/reports/tabular/pdf", tabularReportPdfHandler)
	mux.HandleFunc("/reports/patient-clinical/pdf", patientClinicalPdfHandler)

	reportServiceAddr := requiredEnv("REPORT_SERVICE_ADDR")

	server := &http.Server{
		Addr:         reportServiceAddr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 20 * time.Second,
	}

	log.Printf("Go report service running on %s", reportServiceAddr)
	log.Fatal(server.ListenAndServe())
}
