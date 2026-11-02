import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add isDragging state
states_old = "const [zoomLevel, setZoomLevel] = useState(1.0);"
states_new = "const [zoomLevel, setZoomLevel] = useState(1.0);\n            const [isDragging, setIsDragging] = useState(false);"
content = content.replace(states_old, states_new)

# 2. Refactor handleFileUpload to processFile
handle_upload_old = """            const handleFileUpload = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (evt) => {"""

process_file_new = """            const processFile = (file) => {
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (evt) => {"""
content = content.replace(handle_upload_old, process_file_new)

# Find the end of `reader.readAsBinaryString(file); };`
reader_read_old = """                };
                reader.readAsBinaryString(file);
            };"""

reader_read_new = """                };
                reader.readAsBinaryString(file);
            };
            
            const handleFileUpload = (e) => {
                processFile(e.target.files[0]);
            };
            
            const handleDrop = (e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    processFile(e.dataTransfer.files[0]);
                    e.dataTransfer.clearData();
                }
            };"""
content = content.replace(reader_read_old, reader_read_new)

# 3. Add drag handlers to root div and overlay
root_div_old = """            return (
                <div className="p-4 font-sans text-xs">"""
root_div_new = """            return (
                <div 
                    className="p-4 font-sans text-xs min-h-screen"
                    onDragEnter={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer.types.includes('Files')) {
                            setIsDragging(true);
                        }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                >
                    {isDragging && (
                        <div 
                            className="fixed inset-0 bg-blue-100 bg-opacity-90 z-50 flex flex-col items-center justify-center border-8 border-dashed border-blue-500 m-4 rounded-xl"
                            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                            onDrop={handleDrop}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <svg className="w-24 h-24 text-blue-500 mb-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                            <h2 className="text-4xl font-bold text-blue-700">Drop Excel File Here</h2>
                            <p className="mt-4 text-blue-600 text-lg">Your dashboard will instantly update.</p>
                        </div>
                    )}"""
content = content.replace(root_div_old, root_div_new)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Drag and drop added.")
