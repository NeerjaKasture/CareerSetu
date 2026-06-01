import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, Brain, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import { LanguageSelector } from "./LanguageSelector";
import { assessmentService } from "../services/assessmentService";
import type {
  Page,
  UserProfile,
  TestType,
  Language,
  AssessmentResults,
} from "../App";

interface ProcessingPageProps {
  userProfile: UserProfile;
  setUserProfile: (profile: UserProfile) => void;
  navigateTo: (page: Page, displayResults?: boolean) => void;
  selectedTest: TestType;
  allTestAnswers: { [testType: string]: { [key: number]: string | string[] } };
  testFlow: TestType[];
  assessmentId: number | null;
  isGuestMode?: boolean;
  onResultsReceived: (results: AssessmentResults) => void;
}

const processingSteps = {
  en: [
    { id: 1, text: "Analyzing your responses...", duration: 2000 },
    { id: 2, text: "Identifying your strengths...", duration: 2500 },
    { id: 3, text: "Matching with career paths...", duration: 3000 },
    { id: 4, text: "Generating recommendations...", duration: 2000 },
    { id: 5, text: "Preparing your report...", duration: 1500 },
  ],
  hi: [
    { id: 1, text: "आपकी प्रतिक्रियाओं का विश्लेषण...", duration: 2000 },
    { id: 2, text: "आपकी ताकत की पहचान...", duration: 2500 },
    { id: 3, text: "करियर पथों से मिलान...", duration: 3000 },
    { id: 4, text: "सिफारिशें तैयार की जा रही हैं...", duration: 2000 },
    { id: 5, text: "आपकी रिपोर्ट तैयार की जा रही है...", duration: 1500 },
  ],
  te: [
    { id: 1, text: "మీ ప్రతిస్పందనలను విశ్లేషిస్తోంది...", duration: 2000 },
    { id: 2, text: "మీ బలాలను గుర్తిస్తోంది...", duration: 2500 },
    { id: 3, text: "కెరీర్ మార్గాలతో సరిపోల్చడం...", duration: 3000 },
    { id: 4, text: "సిఫార్సులు రూపొందిస్తోంది...", duration: 2000 },
    { id: 5, text: "మీ నివేదికను సిద్ధం చేస్తోంది...", duration: 1500 },
  ],
  ta: [
    { id: 1, text: "உங்கள் பதில்களை பகுப்பாய்வு செய்கிறது...", duration: 2000 },
    { id: 2, text: "உங்கள் பலங்களை அடையாளம் காணுகிறது...", duration: 2500 },
    { id: 3, text: "தொழில் பாதைகளுடன் பொருத்துகிறது...", duration: 3000 },
    { id: 4, text: "பரிந்துரைகளை உருவாக்குகிறது...", duration: 2000 },
    { id: 5, text: "உங்கள் அறிக்கையை தயாரிக்கிறது...", duration: 1500 },
  ],
  bn: [
    { id: 1, text: "আপনার প্রতিক্রিয়া বিশ্লেষণ করা হচ্ছে...", duration: 2000 },
    { id: 2, text: "আপনার শক্তি চিহ্নিত করা হচ্ছে...", duration: 2500 },
    { id: 3, text: "ক্যারিয়ার পথের সাথে মিলানো হচ্ছে...", duration: 3000 },
    { id: 4, text: "সুপারিশ তৈরি করা হচ্ছে...", duration: 2000 },
    { id: 5, text: "আপনার রিপোর্ট প্রস্তুত করা হচ্ছে...", duration: 1500 },
  ],
  gu: [
    {
      id: 1,
      text: "તમારા પ્રતિસાદોનું વિશ્લેષણ કરી રહ્યા છીએ...",
      duration: 2000,
    },
    { id: 2, text: "તમારી શક્તિઓની ઓળખ કરી રહ્યા છીએ...", duration: 2500 },
    {
      id: 3,
      text: "કારકિર્દી માર્ગો સાથે મેચિંગ કરી રહ્યા છીએ...",
      duration: 3000,
    },
    { id: 4, text: "ભલામણો બનાવી રહ્યા છીએ...", duration: 2000 },
    { id: 5, text: "તમારો રિપોર્ટ તૈયાર કરી રહ્યા છીએ...", duration: 1500 },
  ],
};

const translations = {
  en: {
    processing: "Processing Your Assessment",
    complete: "Analysis Complete!",
    pleaseWait: "Please wait while we analyze your responses",
    success: "Your personalized career recommendations are ready",
    successDesc:
      "We've analyzed your responses and prepared personalized career recommendations based on your aptitudes, values, and interests.",
    viewResults: "View Results",
    progress: "Progress",
    didKnow: "Did you know?",
    funFact:
      "There are over 12,000 different career options available in India! We're helping you find the ones that match your unique profile.",
    thankYou: "Thank you for completing the assessment",
  },
  hi: {
    processing: "आपके मूल्यांकन का विश्लेषण",
    complete: "विश्लेषण पूर्ण!",
    pleaseWait:
      "कृपया प्रतीक्षा करें जब तक हम आपकी प्रतिक्रियाओं का विश्लेषण करते हैं",
    success: "आपकी व्यक्तिगत करियर सिफारिशें तैयार हैं",
    successDesc:
      "हमने आपकी प्रतिक्रियाओं का विश्लेषण किया है और आपकी योग्यताओं, मूल्यों और रुचियों के आधार पर व्यक्तिगत करियर सिफारिशें तैयार की हैं।",
    viewResults: "परिणाम देखें",
    progress: "प्रगति",
    didKnow: "क्या आप जानते हैं?",
    funFact:
      "भारत में 12,000 से अधिक विभिन्न करियर विकल्प उपलब्ध हैं! हम आपको वे खोजने में मदद कर रहे हैं जो आपकी अनूठी प्रोफ़ाइल से मेल खाते हैं।",
    thankYou: "मूल्यांकन पूरा करने के लिए धन्यवाद",
  },
  te: {
    processing: "మీ అసెస్‌మెంట్‌ను ప్రాసెస్ చేస్తోంది",
    complete: "విశ్లేషణ పూర్తయింది!",
    pleaseWait:
      "మేము మీ ప్రతిస్పందనలను విశ్లేషిస్తున్నప్పుడు దయచేసి వేచి ఉండండి",
    success: "మీ వ్యక్తిగత కెరీర్ సిఫార్సులు సిద్ధంగా ఉన్నాయి",
    successDesc:
      "మేము మీ ప్రతిస్పందనలను విశ్లేషించాము మరియు మీ సామర్థ్యాలు, విలువలు మరియు ఆసక్తుల ఆధారంగా వ్యక్తిగత కెరీర్ సిఫార్సులను సిద్ధం చేసాము।",
    viewResults: "ఫలితాలు చూడండి",
    progress: "పురోగతి",
    didKnow: "మీకు తెలుసా?",
    funFact:
      "భారతదేశంలో 12,000 కంటే ఎక్కువ వివిధ కెరీర్ ఎంపికలు అందుబాటులో ఉన్నాయి! మీ ప్రత్యేక ప్రొఫైల్‌కు సరిపోయేవాటిని కనుగొనడంలో మేము మీకు సహాయం చేస్తున్నాము।",
    thankYou: "అసెస్‌మెంట్ పూర్తి చేసినందుకు ధన్యవాదాలు",
  },
  ta: {
    processing: "உங்கள் மதிப்பீட்டை செயலாக்குகிறது",
    complete: "பகுப்பாய்வு முடிந்தது!",
    pleaseWait:
      "நாங்கள் உங்கள் பதில்களை பகுப்பாய்வு செய்யும் வரை காத்திருக்கவும்",
    success: "உங்கள் தனிப்பயன் தொழில் பரிந்துரைகள் தயார்",
    successDesc:
      "நாங்கள் உங்கள் பதில்களை பகுப்பாய்வு செய்து, உங்கள் திறன்கள், மதிப்புகள் மற்றும் ஆர்வங்களின் அடிப்படையில் தனிப்பயன் தொழில் பரிந்துரைகளை தயாரித்துள்ளோம்.",
    viewResults: "முடிவுகளைப் பார்க்கவும்",
    progress: "முன்னேற்றம்",
    didKnow: "உங்களுக்குத் தெரியுமா?",
    funFact:
      "இந்தியாவில் 12,000க்கும் மேற்பட்ட வெவ்வேறு தொழில் விருப்பங்கள் உள்ளன! உங்கள் தனித்துவமான சுயவிவரத்துடன் பொருந்தும் விருப்பங்களைக் கண்டறிய நாங்கள் உதவுகிறோம்.",
    thankYou: "மதிப்பீட்டை முடித்ததற்கு நன்றி",
  },
  bn: {
    processing: "আপনার মূল্যায়ন প্রক্রিয়া করা হচ্ছে",
    complete: "বিশ্লেষণ সম্পূর্ণ!",
    pleaseWait: "আমরা আপনার উত্তর বিশ্লেষণ করার সময় অপেক্ষা করুন",
    success: "আপনার ব্যক্তিগত ক্যারিয়ার সুপারিশ প্রস্তুত",
    successDesc:
      "আমরা আপনার উত্তর বিশ্লেষণ করেছি এবং আপনার যোগ্যতা, মূল্যবোধ এবং আগ্রহের ভিত্তিতে ব্যক্তিগত ক্যারিয়ার সুপারিশ প্রস্তুত করেছি।",
    viewResults: "ফলাফল দেখুন",
    progress: "অগ্রগতি",
    didKnow: "আপনি কি জানেন?",
    funFact:
      "ভারতে 12,000 এরও বেশি বিভিন্ন ক্যারিয়ার বিকল্প উপলব্ধ! আমরা আপনাকে এমনগুলি খুঁজে পেতে সাহায্য করছি যা আপনার অনন্য প্রোফাইলের সাথে মেলে।",
    thankYou: "মূল্যায়ন সম্পূর্ণ করার জন্য ধন্যবাদ",
  },
  gu: {
    processing: "તમારું મૂલ્યાંકન પ્રોસેસ કરી રહ્યા છીએ",
    complete: "વિશ્લેષણ પૂર્ણ!",
    pleaseWait:
      "કૃપા કરી રાહ જુઓ જ્યારે અમે તમારા પ્રતિસાદોનું વિશ્લેષણ કરીએ છીએ",
    success: "તમારી વ્યક્તિગત કારકિર્દી ભલામણો તૈયાર છે",
    successDesc:
      "અમે તમારા પ્રતિસાદોનું વિશ્લેષણ કર્યું છે અને તમારી યોગ્યતાઓ, મૂલ્યો અને રુચિઓના આધારે વ્યક્તિગત કારકિર્દી ભલામણો તૈયાર કરી છે.",
    viewResults: "પરિણામો જુઓ",
    progress: "પ્રગતિ",
    didKnow: "શું તમે જાણો છો?",
    funFact:
      "ભારતમાં 12,000 થી વધુ વિવિધ કારકિર્દી વિકલ્પો ઉપલબ્ધ છે! અમે તમને તે વિકલ્પો શોધવામાં મદદ કરી રહ્યા છીએ જે તમારી અનન્ય પ્રોફાઇલ સાથે મેળ ખાય છે.",
    thankYou: "મૂલ્યાંકન પૂર્ણ કરવા બદલ આભાર",
  },
};

export function ProcessingPage({
  userProfile,
  setUserProfile,
  navigateTo,
  selectedTest,
  allTestAnswers,
  testFlow,
  assessmentId,
  isGuestMode = false,
  onResultsReceived,
}: ProcessingPageProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [assessmentResults, setAssessmentResults] = useState<any>(null);
  const lang = userProfile.language;
  const t = translations[lang];
  const steps = processingSteps[lang];

  const handleLanguageChange = (newLang: Language) => {
    setUserProfile({ ...userProfile, language: newLang });
  };

  // Start processing assessment when animation starts (not when it finishes)
  useEffect(() => {
    // Start processing after a short delay to show animation
    if (currentStep > 0 && !isProcessing && !isComplete) {
      const timer = setTimeout(() => {
        setIsProcessing(true);
        submitAssessment();
      }, 1000); // Start processing 1 second after animation starts
      return () => clearTimeout(timer);
    }
  }, [currentStep]);

  // Don't auto-navigate - let user click "View Results" button manually
  // Results are ready when isComplete is true, but user controls when to view them

  const submitAssessment = async () => {
    try {
      // In guest mode, show mock results without backend call
      if (isGuestMode) {
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const mockResults: AssessmentResults = {
          recommendations: [
            {
              title: "Software Developer",
              confidence: 0.92,
              reason: "Your analytical thinking and problem-solving skills align well with software development.",
              next_steps: ["Learn programming basics", "Build personal projects", "Explore computer science courses"]
            },
            {
              title: "Data Analyst",
              confidence: 0.88,
              reason: "Your attention to detail and logical reasoning make you suitable for data analysis.",
              next_steps: ["Study statistics", "Learn data visualization tools", "Practice with real datasets"]
            },
            {
              title: "UX Designer",
              confidence: 0.85,
              reason: "Your creativity combined with technical interest suggests UX design as a great fit.",
              next_steps: ["Learn design principles", "Study user psychology", "Build a portfolio"]
            }
          ],
          summary: "Based on your responses, you show strong aptitude for technology and creative problem-solving. Consider careers that blend analytical thinking with innovation."
        };
        
        setAssessmentResults(mockResults);
        onResultsReceived(mockResults);
        setIsComplete(true);
        setIsProcessing(false);
        return;
      }

      // Regular backend submission for logged-in users
      // Prepare assessment payload
      const tests = testFlow.map((testType) => ({
        type: testType,
        answers: allTestAnswers[testType] || {},
      }));

      const payload = {
        userProfile: {
          name: userProfile.name,
          class: userProfile.class,
          age: userProfile.age,
          language: userProfile.language,
          email: userProfile.email,
          phone: userProfile.phone,
        },
        tests,
        completedAt: new Date().toISOString(),
        assessmentId: assessmentId || Date.now(),
      };

      const response = await assessmentService.completeAssessment(payload);
      const results: AssessmentResults = response.data;
      setAssessmentResults(results);
      onResultsReceived(results);
      setIsComplete(true);
    } catch (error) {
      console.error("Error submitting assessment:", error);
      // Still mark as complete with fallback
      setIsComplete(true);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (currentStep < steps.length) {
      const timer = setTimeout(() => {
        setCurrentStep(currentStep + 1);
        setProgress(((currentStep + 1) / steps.length) * 100);
      }, steps[currentStep].duration);

      return () => clearTimeout(timer);
    }
  }, [currentStep, steps.length]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4">
      <div className="absolute top-4 right-4">
        <LanguageSelector
          language={userProfile.language}
          onLanguageChange={handleLanguageChange}
        />
      </div>

      <div className="max-w-2xl w-full">
        <Card className="border-2 shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-8 text-white text-center">
            <div className="inline-block p-4 bg-white/20 rounded-full mb-4">
              {isComplete ? (
                <CheckCircle2 className="h-12 w-12" />
              ) : (
                <Brain className="h-12 w-12 animate-pulse" />
              )}
            </div>
            <h2 className="text-white mb-2">
              {isComplete ? t.complete : t.processing}
            </h2>
            <p className="text-blue-100">
              {isComplete ? t.success : t.pleaseWait}
            </p>
          </div>

          <CardContent className="p-8">
            {/* Progress Bar */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">{t.progress}</span>
                <span className="text-sm text-gray-900">
                  {Math.round(progress)}%
                </span>
              </div>
              <Progress value={progress} className="h-3" />
            </div>

            {/* Processing Steps */}
            <div className="space-y-4">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 transition-all duration-500 ${
                    index < currentStep
                      ? "opacity-100"
                      : index === currentStep
                      ? "opacity-100"
                      : "opacity-30"
                  }`}
                >
                  <div className="shrink-0">
                    {index < currentStep ? (
                      <div className="bg-green-500 rounded-full p-1">
                        <CheckCircle2 className="h-5 w-5 text-white" />
                      </div>
                    ) : index === currentStep ? (
                      <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
                    ) : (
                      <div className="h-6 w-6 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                  <span
                    className={
                      index <= currentStep ? "text-gray-900" : "text-gray-400"
                    }
                  >
                    {step.text}
                  </span>
                </div>
              ))}
            </div>

            {/* Completion Message */}
            {isComplete && (
              <div className="mt-8 p-6 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border-2 border-green-200">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-6 w-6 text-green-600 shrink-0 mt-1" />
                  <div>
                    <h3 className="text-green-900 mb-2">{t.complete}</h3>
                    <p className="text-green-700 text-sm mb-4">
                      {t.successDesc}
                    </p>
                    <Button
                      onClick={() => navigateTo("chatbot", true, assessmentId || undefined)}
                      className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                    >
                      {t.viewResults}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Fun Fact */}
            {!isComplete && (
              <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-900">
                  <strong>{t.didKnow}</strong> {t.funFact}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Additional Info */}
        <div className="mt-6 text-center">
          <p className="text-gray-600 text-sm">
            {t.thankYou}, {userProfile.name}!
          </p>
        </div>
      </div>
    </div>
  );
}
